import type { Api, Model } from "@earendil-works/pi-ai";
import type { AuthResult } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import {
	isKimiModel,
	normalizeKimiCodeBaseUrl,
	presentHeaders,
	resolveKimiWebServiceConfig,
} from "../src/config.js";

describe("normalizeKimiCodeBaseUrl", () => {
	it("appends /v1 when the URL ends in /coding (pi stores the LLM root)", () => {
		expect(normalizeKimiCodeBaseUrl("https://api.kimi.com/coding")).toBe(
			"https://api.kimi.com/coding/v1",
		);
	});

	it("strips trailing slashes before normalizing", () => {
		expect(normalizeKimiCodeBaseUrl("https://api.kimi.com/coding/")).toBe(
			"https://api.kimi.com/coding/v1",
		);
		expect(normalizeKimiCodeBaseUrl("https://api.kimi.com/coding/v1/")).toBe(
			"https://api.kimi.com/coding/v1",
		);
	});

	it("keeps unrelated paths as-is", () => {
		expect(normalizeKimiCodeBaseUrl("https://example.com/proxy/")).toBe(
			"https://example.com/proxy",
		);
	});
});

describe("presentHeaders", () => {
	it("drops null-valued entries and keeps the rest", () => {
		expect(presentHeaders({ "X-A": "1", "X-B": null, "X-C": "" })).toEqual({
			"X-A": "1",
			"X-C": "",
		});
	});

	it("handles undefined input", () => {
		expect(presentHeaders(undefined)).toEqual({});
	});
});

describe("isKimiModel", () => {
	const model = (provider: string, baseUrl: string) => ({ provider, baseUrl }) as Model<Api>;

	it("matches by provider id containing 'kimi'", () => {
		expect(isKimiModel(model("kimi-coding", "https://example.com"))).toBe(true);
		expect(isKimiModel(model("Kimi-Custom", "https://example.com"))).toBe(true);
	});

	it("matches by Kimi service base URL even with a renamed provider", () => {
		expect(isKimiModel(model("custom", "https://api.kimi.com/coding"))).toBe(true);
		expect(isKimiModel(model("custom", "https://api.moonshot.cn/v1"))).toBe(true);
	});

	it("rejects unrelated models and undefined", () => {
		expect(isKimiModel(model("deepseek", "https://api.deepseek.com"))).toBe(false);
		expect(isKimiModel(undefined)).toBe(false);
	});
});

describe("resolveKimiWebServiceConfig", () => {
	const ctxWithAuth = (auth: AuthResult | undefined) =>
		({
			modelRegistry: { getProviderAuth: async () => auth },
		}) as unknown as ExtensionContext;

	afterEach(() => {
		delete process.env.KIMI_API_KEY;
		delete process.env.MOONSHOT_API_KEY;
	});

	it("returns undefined when nothing is configured", async () => {
		expect(await resolveKimiWebServiceConfig(ctxWithAuth(undefined))).toBeUndefined();
		expect(await resolveKimiWebServiceConfig(ctxWithAuth({ auth: {} }))).toBeUndefined();
	});

	it("ignores API key environment variables; provider auth is the only source", async () => {
		process.env.KIMI_API_KEY = "env-key";
		process.env.MOONSHOT_API_KEY = "env-key";
		expect(await resolveKimiWebServiceConfig(ctxWithAuth(undefined))).toBeUndefined();
	});

	it("wraps a stored provider API key as a Bearer header", async () => {
		const config = await resolveKimiWebServiceConfig(
			ctxWithAuth({ auth: { apiKey: "stored-key" } }),
		);
		expect(config?.headers.Authorization).toBe("Bearer stored-key");
	});

	it("reuses the OAuth Authorization header from the resolved auth", async () => {
		const config = await resolveKimiWebServiceConfig(
			ctxWithAuth({
				auth: {
					headers: { Authorization: "Bearer oauth-access-token", "X-Other": "keep" },
					baseUrl: "https://api.kimi.com/coding",
				},
				source: "OAuth",
			}),
		);
		expect(config).toEqual({
			searchEndpoint: "https://api.kimi.com/coding/v1/search",
			fetchEndpoint: "https://api.kimi.com/coding/v1/fetch",
			headers: { Authorization: "Bearer oauth-access-token", "X-Other": "keep" },
		});
	});
});
