// Ported from MoonshotAI/kimi-code (MIT): packages/agent-core web tools.

import {
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
	truncateHead,
} from "@earendil-works/pi-coding-agent";

import type { UrlFetchKind, WebSearchResult } from "./providers.js";

const CITATION_REMINDER =
	"When you rely on a result in your answer, cite it inline as a markdown link, e.g. [title](url).";

export function formatSearchResults(results: WebSearchResult[]): string {
	const blocks = results.map((result) => {
		const lines = [`Title: ${result.title}`];
		if (result.siteName) lines.push(`Site: ${result.siteName}`);
		if (result.date) lines.push(`Date: ${result.date}`);
		lines.push(`URL: ${result.url}`, `Snippet: ${result.snippet}`);
		return lines.join("\n");
	});
	return `${blocks.join("\n---\n\n")}\n\n${CITATION_REMINDER}`;
}

export function classifySearchError(error: unknown): string {
	const name = error instanceof Error ? error.name : "";
	const message = error instanceof Error ? error.message : String(error);
	const lower = message.toLowerCase();

	if (name === "AbortError" || lower.includes("abort")) return `Search cancelled: ${message}`;
	if (name === "TimeoutError" || lower.includes("timed out") || lower.includes("timeout")) {
		return `Search timed out: ${message}`;
	}
	if (lower.includes("401") || lower.includes("unauthorized") || lower.includes("auth")) {
		return `Search failed (authentication): ${message}`;
	}
	if (
		lower.includes("http ") ||
		lower.includes("network") ||
		lower.includes("fetch") ||
		name === "TypeError"
	) {
		return `Search failed (network): ${message}`;
	}
	return `Search failed: ${message}`;
}

export function truncateForModel(output: string): string {
	const truncation = truncateHead(output, {
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	});
	if (!truncation.truncated) return truncation.content;
	return (
		`${truncation.content}\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines` +
		` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`
	);
}

// Ported verbatim from kimi-code's tool prompts.
export const WEB_SEARCH_DESCRIPTION =
	"Search the web for information. Use this when you need up-to-date information from the internet.\n\n" +
	"Each result includes its title, its URL, and a snippet, plus its source site and publication date " +
	"when available. Results are short summaries, not full pages — when a result looks relevant, call " +
	"the web_fetch tool on its URL to read the full page content. Fetch only the few URLs you actually " +
	"need. Prefer specific queries, and refine the query if the results don't contain what you need.\n\n" +
	"When you rely on a result in your answer, cite its source URL so the user can verify it.";

export const WEB_FETCH_DESCRIPTION =
	"Fetch content from a URL. The content is returned either as the main text extracted from the page, " +
	"or as the full response body verbatim; a note at the top of the result states which of the two you " +
	"received, so you can judge how complete it is. Use this when you need to read a specific web page.\n\n" +
	"Only fully-formed public `http`/`https` URLs are supported; other schemes and private or loopback " +
	"addresses are not fetched. Very large pages may be truncated or refused. The fetch carries no login " +
	"or session for the target site, so pages behind authentication (private repositories, internal " +
	"dashboards) return a login page or an error instead of the real content — if the text you get back " +
	"looks like a generic landing or sign-in page, treat that as the login wall, not the answer, and " +
	"reach the content through a credentialed route (an authenticated CLI or MCP tool) instead.";

export interface WebSearchToolDetails {
	query: string;
	results: WebSearchResult[];
}

export interface WebFetchToolDetails {
	url: string;
	kind: UrlFetchKind;
	/** UTF-8 byte length of the fetched content before model-facing truncation. */
	byteLength: number;
}
