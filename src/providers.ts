// Ported from MoonshotAI/kimi-code (MIT): packages/agent-core web tools.

import type { KimiWebServiceConfig } from "./config.js";

export interface WebSearchResult {
	title: string;
	url: string;
	snippet: string;
	siteName?: string;
	date?: string;
}

export type UrlFetchKind = "passthrough" | "extracted";

export interface UrlFetchResult {
	content: string;
	kind: UrlFetchKind;
}

export class HttpFetchError extends Error {
	override readonly name = "HttpFetchError";
	readonly status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

interface MoonshotSearchResultWire {
	site_name?: string;
	title?: string;
	url?: string;
	snippet?: string;
	content?: string;
	date?: string;
	icon?: string;
	mime?: string;
}

interface MoonshotSearchResponseWire {
	search_results?: MoonshotSearchResultWire[];
}

export interface KimiRequestContext {
	toolCallId?: string;
	signal?: AbortSignal;
}

/** kimi-code sends this header so the service can correlate requests with tool calls. */
const TOOL_CALL_ID_HEADER = "X-Msh-Tool-Call-Id";

const SEARCH_REQUEST_TIMEOUT_MS = 30_000;
export const FETCH_REQUEST_TIMEOUT_MS = 60_000;

export function requestSignal(caller: AbortSignal | undefined, timeoutMs: number): AbortSignal {
	const timeout = AbortSignal.timeout(timeoutMs);
	return caller ? AbortSignal.any([caller, timeout]) : timeout;
}

async function safeReadBody(response: Response): Promise<string> {
	try {
		return await response.text();
	} catch {
		return "";
	}
}

export class KimiWebSearchProvider {
	constructor(private readonly config: KimiWebServiceConfig) {}

	async search(query: string, reqCtx: KimiRequestContext): Promise<WebSearchResult[]> {
		const response = await this.post(JSON.stringify({ text_query: query }), reqCtx);

		if (response.status !== 200) {
			const detail = await safeReadBody(response);
			const suffix = response.status === 401 ? " (auth/unauthorized)" : "";
			throw new Error(
				`Moonshot search request failed: HTTP ${response.status}${suffix}. ${detail}`.trim(),
			);
		}

		const json = (await response.json()) as MoonshotSearchResponseWire;
		const rawResults = Array.isArray(json.search_results) ? json.search_results : [];
		return rawResults.map((raw) => {
			const result: WebSearchResult = {
				title: raw.title ?? "",
				url: raw.url ?? "",
				snippet: raw.snippet ?? "",
			};
			if (typeof raw.date === "string" && raw.date.length > 0) result.date = raw.date;
			if (typeof raw.site_name === "string" && raw.site_name.length > 0) {
				result.siteName = raw.site_name;
			}
			return result;
		});
	}

	private post(bodyJson: string, reqCtx: KimiRequestContext): Promise<Response> {
		return fetch(this.config.searchEndpoint, {
			method: "POST",
			headers: {
				...this.config.headers,
				"Content-Type": "application/json",
				...(reqCtx.toolCallId ? { [TOOL_CALL_ID_HEADER]: reqCtx.toolCallId } : {}),
			},
			body: bodyJson,
			signal: requestSignal(reqCtx.signal, SEARCH_REQUEST_TIMEOUT_MS),
		});
	}
}

export interface UrlFetcher {
	fetch(url: string, reqCtx: KimiRequestContext): Promise<UrlFetchResult>;
}

export class KimiFetchUrlProvider implements UrlFetcher {
	constructor(
		private readonly config: KimiWebServiceConfig,
		private readonly localFallback: UrlFetcher,
	) {}

	async fetch(url: string, reqCtx: KimiRequestContext): Promise<UrlFetchResult> {
		try {
			// The service returns the main page text it already extracted.
			const content = await this.fetchViaMoonshot(url, reqCtx);
			return { content, kind: "extracted" };
		} catch (error) {
			if (reqCtx.signal?.aborted) throw error;
			return this.localFallback.fetch(url, reqCtx);
		}
	}

	private async fetchViaMoonshot(url: string, reqCtx: KimiRequestContext): Promise<string> {
		const response = await fetch(this.config.fetchEndpoint, {
			method: "POST",
			headers: {
				...this.config.headers,
				Accept: "text/markdown",
				"Content-Type": "application/json",
				...(reqCtx.toolCallId ? { [TOOL_CALL_ID_HEADER]: reqCtx.toolCallId } : {}),
			},
			body: JSON.stringify({ url }),
			signal: requestSignal(reqCtx.signal, FETCH_REQUEST_TIMEOUT_MS),
		});

		if (response.status !== 200) {
			const detail = await safeReadBody(response);
			throw new HttpFetchError(
				response.status,
				`Moonshot fetch request failed: HTTP ${response.status}. ${detail}`.trim(),
			);
		}
		return response.text();
	}
}
