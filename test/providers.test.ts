import { afterEach, describe, expect, it, vi } from "vitest";

import type { KimiWebServiceConfig } from "../src/config.js";
import { LocalUrlFallbackFetcher } from "../src/local-fetch.js";
import {
	HttpFetchError,
	KimiFetchUrlProvider,
	KimiWebSearchProvider,
	type UrlFetcher,
} from "../src/providers.js";

const config: KimiWebServiceConfig = {
	searchEndpoint: "https://api.kimi.com/coding/v1/search",
	fetchEndpoint: "https://api.kimi.com/coding/v1/fetch",
	headers: { Authorization: "Bearer test-key", "X-Provider": "yes" },
};

const PUBLIC_A = "http://93.184.216.34/a";
const PUBLIC_B = "http://93.184.216.35/b";

afterEach(() => {
	vi.unstubAllGlobals();
});

function stubFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
	const mock = vi.fn(handler);
	vi.stubGlobal("fetch", mock);
	return mock;
}

describe("KimiWebSearchProvider", () => {
	it("maps wire results to the domain model, defaulting and dropping fields", async () => {
		stubFetch(async () =>
			Response.json({
				search_results: [
					{
						title: "T",
						url: "https://u.example",
						snippet: "S",
						site_name: "site",
						date: "2026-08-01",
						icon: "ignored",
					},
					{ url: "https://minimal.example", site_name: "", date: "" },
				],
			}),
		);

		const results = await new KimiWebSearchProvider(config).search("query", {});
		expect(results).toEqual([
			{
				title: "T",
				url: "https://u.example",
				snippet: "S",
				siteName: "site",
				date: "2026-08-01",
			},
			{ title: "", url: "https://minimal.example", snippet: "" },
		]);
	});

	it("sends auth, provider and tool-call headers with the text_query body", async () => {
		const mock = stubFetch(async () => Response.json({ search_results: [] }));
		await new KimiWebSearchProvider(config).search("hello", { toolCallId: "call-1" });

		const [url, init] = mock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(config.searchEndpoint);
		expect(init.method).toBe("POST");
		expect(JSON.parse(init.body as string)).toEqual({ text_query: "hello" });
		const headers = new Headers(init.headers);
		expect(headers.get("Authorization")).toBe("Bearer test-key");
		expect(headers.get("X-Provider")).toBe("yes");
		expect(headers.get("X-Msh-Tool-Call-Id")).toBe("call-1");
	});

	it("throws with the HTTP status and body detail on non-200", async () => {
		stubFetch(async () => new Response("nope", { status: 401 }));
		await expect(new KimiWebSearchProvider(config).search("q", {})).rejects.toThrow(
			/HTTP 401 \(auth\/unauthorized\)\. nope/,
		);
	});

	it("tolerates a missing search_results field", async () => {
		stubFetch(async () => Response.json({}));
		await expect(new KimiWebSearchProvider(config).search("q", {})).resolves.toEqual([]);
	});
});

describe("KimiFetchUrlProvider", () => {
	it("returns Moonshot content as kind=extracted", async () => {
		stubFetch(async () => new Response("# page", { status: 200 }));
		const fallback: UrlFetcher = { fetch: vi.fn() };
		const result = await new KimiFetchUrlProvider(config, fallback).fetch(PUBLIC_A, {});
		expect(result).toEqual({ content: "# page", kind: "extracted" });
		expect(fallback.fetch).not.toHaveBeenCalled();
	});

	it("falls back to the local fetcher on any Moonshot failure", async () => {
		stubFetch(async () => new Response("boom", { status: 500 }));
		const fallback: UrlFetcher = {
			fetch: vi.fn(async () => ({ content: "local", kind: "passthrough" as const })),
		};
		const result = await new KimiFetchUrlProvider(config, fallback).fetch(PUBLIC_A, {
			toolCallId: "c",
		});
		expect(fallback.fetch).toHaveBeenCalledWith(PUBLIC_A, { toolCallId: "c" });
		expect(result).toEqual({ content: "local", kind: "passthrough" });
	});

	it("rethrows instead of falling back when the caller aborted", async () => {
		stubFetch(async () => {
			throw new DOMException("The operation was aborted", "AbortError");
		});
		const fallback: UrlFetcher = { fetch: vi.fn() };
		const controller = new AbortController();
		controller.abort();
		await expect(
			new KimiFetchUrlProvider(config, fallback).fetch(PUBLIC_A, { signal: controller.signal }),
		).rejects.toThrow(/aborted/);
		expect(fallback.fetch).not.toHaveBeenCalled();
	});
});

describe("LocalUrlFallbackFetcher", () => {
	const fetcher = new LocalUrlFallbackFetcher();

	it("passes text/plain bodies through verbatim", async () => {
		stubFetch(
			async () =>
				new Response("raw text", { status: 200, headers: { "content-type": "text/plain" } }),
		);
		expect(await fetcher.fetch(PUBLIC_A, {})).toEqual({ content: "raw text", kind: "passthrough" });
	});

	it("extracts main content from HTML responses", async () => {
		stubFetch(
			async () =>
				new Response("<html><body>hello world</body></html>", {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		);
		const result = await fetcher.fetch(PUBLIC_A, {});
		expect(result.kind).toBe("extracted");
		expect(result.content).toContain("hello world");
	});

	it("passes JSON and other text/* responses through verbatim", async () => {
		stubFetch(async (url) =>
			url === PUBLIC_A
				? new Response('{"a":1}', { status: 200, headers: { "content-type": "application/json" } })
				: new Response("a,b\n1,2", { status: 200, headers: { "content-type": "text/csv" } }),
		);
		expect(await fetcher.fetch(PUBLIC_A, {})).toEqual({ content: '{"a":1}', kind: "passthrough" });
		expect(await fetcher.fetch(PUBLIC_B, {})).toEqual({ content: "a,b\n1,2", kind: "passthrough" });
	});

	it("refuses binary content types with an explicit message", async () => {
		stubFetch(
			async () =>
				new Response("\x00\x01", {
					status: 200,
					headers: { "content-type": "application/octet-stream" },
				}),
		);
		await expect(fetcher.fetch(PUBLIC_A, {})).rejects.toThrow(/Unsupported content type/);
	});

	it("still attempts extraction when content-type is absent", async () => {
		// Blob bodies carry no implicit content-type, unlike string bodies.
		stubFetch(
			async () =>
				new Response(new Blob(["<html><body>hello world</body></html>"]), { status: 200 }),
		);
		const result = await fetcher.fetch(PUBLIC_A, {});
		expect(result.kind).toBe("extracted");
		expect(result.content).toContain("hello world");
	});

	it("treats non-redirect 3xx as an HTTP error", async () => {
		stubFetch(async () => new Response(null, { status: 304, statusText: "Not Modified" }));
		const error = await fetcher.fetch(PUBLIC_A, {}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(HttpFetchError);
		expect((error as HttpFetchError).status).toBe(304);
	});

	it("follows redirects with the SSRF check re-run per hop", async () => {
		const mock = stubFetch(async (url) => {
			if (url === PUBLIC_A) {
				return new Response(null, { status: 302, headers: { location: PUBLIC_B } });
			}
			return new Response("final", { status: 200, headers: { "content-type": "text/markdown" } });
		});
		const result = await fetcher.fetch(PUBLIC_A, {});
		expect(result).toEqual({ content: "final", kind: "passthrough" });
		expect(mock).toHaveBeenCalledTimes(2);
	});

	it("refuses a redirect into a private address", async () => {
		stubFetch(
			async () =>
				new Response(null, { status: 302, headers: { location: "http://127.0.0.1/internal" } }),
		);
		await expect(fetcher.fetch(PUBLIC_A, {})).rejects.toThrow(/private address/);
	});

	it("gives up after the redirect limit", async () => {
		stubFetch(async (url) => new Response(null, { status: 302, headers: { location: `${url}x` } }));
		await expect(fetcher.fetch(PUBLIC_A, {})).rejects.toThrow(/Too many redirects/);
	});

	it("throws HttpFetchError with the status for >= 400 responses", async () => {
		stubFetch(async () => new Response("gone", { status: 404, statusText: "Not Found" }));
		const error = await fetcher.fetch(PUBLIC_A, {}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(HttpFetchError);
		expect((error as HttpFetchError).status).toBe(404);
	});

	it("rejects oversized bodies announced via content-length before reading", async () => {
		const mock = stubFetch(
			async () =>
				new Response("x", {
					status: 200,
					headers: { "content-length": String(11 * 1024 * 1024) },
				}),
		);
		await expect(fetcher.fetch(PUBLIC_A, {})).rejects.toThrow(/too large/);
		expect(mock).toHaveBeenCalledTimes(1);
	});

	it("refuses SSRF targets without issuing any request", async () => {
		const mock = stubFetch(async () => new Response("should not happen"));
		await expect(fetcher.fetch("http://169.254.169.254/latest/meta-data", {})).rejects.toThrow(
			/private address/,
		);
		expect(mock).not.toHaveBeenCalled();
	});
});
