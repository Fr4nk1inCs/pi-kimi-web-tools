// Ported from MoonshotAI/kimi-code (MIT): packages/agent-core web tools.

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

import { Readability } from "@mozilla/readability";
import { parseHTML as rawParseHTML } from "linkedom";

import {
	FETCH_REQUEST_TIMEOUT_MS,
	HttpFetchError,
	type KimiRequestContext,
	requestSignal,
	type UrlFetcher,
	type UrlFetchResult,
} from "./providers.js";

const LOCAL_FETCH_USER_AGENT =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
	"(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";

const LOCAL_FETCH_MAX_BYTES = 10 * 1024 * 1024;
const LOCAL_FETCH_MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PRIVATE_ADDRESS_BLOCKLIST = (() => {
	const list = new BlockList();
	list.addSubnet("0.0.0.0", 8, "ipv4"); // "this network"
	list.addSubnet("10.0.0.0", 8, "ipv4");
	list.addSubnet("100.64.0.0", 10, "ipv4"); // CGNAT
	list.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
	list.addSubnet("169.254.0.0", 16, "ipv4"); // link-local / cloud metadata
	list.addSubnet("172.16.0.0", 12, "ipv4");
	list.addSubnet("192.168.0.0", 16, "ipv4");
	list.addSubnet("::", 128, "ipv6"); // unspecified
	list.addSubnet("::1", 128, "ipv6"); // loopback
	list.addSubnet("fc00::", 7, "ipv6"); // ULA
	list.addSubnet("fe80::", 10, "ipv6"); // link-local
	return list;
})();

export function isBlockedAddress(address: string): boolean {
	// Link-local addresses may carry a zone id ("fe80::1%en0") — strip it.
	const normalized = address.split("%", 1)[0] ?? address;
	if (isIP(normalized) === 4) return PRIVATE_ADDRESS_BLOCKLIST.check(normalized, "ipv4");
	return isIP(normalized) === 6 && PRIVATE_ADDRESS_BLOCKLIST.check(normalized, "ipv6");
}

export async function assertPublicFetchTarget(url: string): Promise<void> {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`Invalid URL: "${url}"`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`Unsupported URL scheme "${parsed.protocol}" — only http(s) allowed.`);
	}
	// URL.hostname keeps surrounding [ ] for IPv6 literals on some Node
	// versions; strip them for uniform comparison.
	const rawHost = parsed.hostname.toLowerCase();
	const host = rawHost.startsWith("[") && rawHost.endsWith("]") ? rawHost.slice(1, -1) : rawHost;

	if (isIP(host) !== 0) {
		if (isBlockedAddress(host)) throw new Error(`Refusing to fetch private address: "${host}"`);
		return;
	}
	if (host === "localhost" || host.endsWith(".localhost")) {
		throw new Error(`Refusing to fetch private host: "${host}"`);
	}

	let addresses: { address: string }[];
	try {
		addresses = await lookup(host, { all: true });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cannot resolve host "${host}" for the fetch safety check: ${detail}`);
	}
	for (const { address } of addresses) {
		if (isBlockedAddress(address)) {
			throw new Error(
				`Refusing to fetch host "${host}": resolves to private address "${address}".`,
			);
		}
	}
}

// linkedom's published types depend on DOM libs pi extensions don't load;
// declare the minimal surface used here so the file stays self-contained.
interface DomElementLike {
	textContent: string | null;
	querySelector(selector: string): DomElementLike | null;
}
const parseHTML = rawParseHTML as unknown as (html: string) => { document: DomElementLike };
// Readability's .d.ts references the global DOM Document type; extract its
// constructor parameter type instead of pulling lib.dom into the extension.
type ReadabilityDocument = ConstructorParameters<typeof Readability>[0];

export class LocalUrlFallbackFetcher implements UrlFetcher {
	async fetch(url: string, reqCtx: KimiRequestContext): Promise<UrlFetchResult> {
		const response = await this.requestWithValidatedRedirects(url, reqCtx);
		return this.readResponse(response);
	}

	private async requestWithValidatedRedirects(
		initialUrl: string,
		reqCtx: KimiRequestContext,
	): Promise<Response> {
		// One deadline for the whole redirect chain, not per hop.
		const signal = requestSignal(reqCtx.signal, FETCH_REQUEST_TIMEOUT_MS);
		let currentUrl = initialUrl;
		for (let hop = 0; ; hop++) {
			await assertPublicFetchTarget(currentUrl);
			const response = await fetch(currentUrl, {
				method: "GET",
				headers: { "User-Agent": LOCAL_FETCH_USER_AGENT },
				redirect: "manual", // re-run the SSRF check on every hop
				signal,
			});
			if (!REDIRECT_STATUSES.has(response.status)) return response;
			const location = response.headers.get("location");
			if (location === null) return response;
			// Drain so the socket returns to the keep-alive pool.
			await response.body?.cancel().catch(() => {});
			if (hop >= LOCAL_FETCH_MAX_REDIRECTS) {
				throw new Error(
					`Too many redirects while fetching "${initialUrl}" (limit ${LOCAL_FETCH_MAX_REDIRECTS}).`,
				);
			}
			currentUrl = new URL(location, currentUrl).toString();
		}
	}

	private async readResponse(response: Response): Promise<UrlFetchResult> {
		// Redirects are already resolved by requestWithValidatedRedirects; any
		// other 3xx reaching here is final and carries no usable body.
		if (response.status >= 300) {
			await response.body?.cancel().catch(() => {});
			throw new HttpFetchError(response.status, `HTTP ${response.status} ${response.statusText}`);
		}

		const contentLength = Number(response.headers.get("content-length"));
		if (Number.isFinite(contentLength) && contentLength > LOCAL_FETCH_MAX_BYTES) {
			await response.body?.cancel().catch(() => {});
			throw new Error(
				`Response body too large: ${contentLength} bytes exceeds the ${LOCAL_FETCH_MAX_BYTES}-byte limit.`,
			);
		}
		const body = await response.text();
		// Servers may omit content-length — measure the buffered body too.
		const byteLength = Buffer.byteLength(body, "utf8");
		if (byteLength > LOCAL_FETCH_MAX_BYTES) {
			throw new Error(
				`Response body too large: ${byteLength} bytes exceeds the ${LOCAL_FETCH_MAX_BYTES}-byte limit.`,
			);
		}

		const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
		if (contentType.startsWith("text/html") || contentType.startsWith("application/xhtml+xml")) {
			return { content: extractMainContent(body), kind: "extracted" };
		}
		if (
			contentType.startsWith("text/") ||
			contentType.startsWith("application/json") ||
			contentType.includes("+json")
		) {
			return { content: body, kind: "passthrough" };
		}
		if (contentType === "") return { content: extractMainContent(body), kind: "extracted" };
		throw new Error(`Unsupported content type "${contentType}" — only text and JSON can be read.`);
	}
}

export function extractMainContent(html: string): string {
	// Readability mutates the DOM it parses, so parse twice.
	const primary = parseHTML(html);
	try {
		const article = new Readability(primary.document as unknown as ReadabilityDocument, {
			charThreshold: 0,
		}).parse();
		const text = article?.textContent?.trim() ?? "";
		if (article !== null && text.length > 0) {
			const title = article.title?.trim() ?? "";
			return title.length > 0 ? `# ${title}\n\n${text}` : text;
		}
	} catch {
		/* fall through to the container fallback */
	}

	const { document } = parseHTML(html);
	const titleText = (document.querySelector("title")?.textContent ?? "").trim();
	const container =
		document.querySelector("article") ??
		document.querySelector("main") ??
		document.querySelector("body");
	const fallbackText = (container?.textContent ?? "").trim();
	if (fallbackText.length === 0) {
		throw new Error(
			"Failed to extract meaningful content from the page. The page may require JavaScript to render.",
		);
	}
	return titleText.length > 0 ? `# ${titleText}\n\n${fallbackText}` : fallbackText;
}
