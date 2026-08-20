/**
 * Kimi Web Tools — `web_search` and `web_fetch` backed by the Kimi for Coding
 * web services, ported from MoonshotAI/kimi-code (MIT).
 */

import { formatSize } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import { hasKimiCredential, isKimiModel, resolveKimiWebServiceConfig } from "./src/config.js";
import {
	classifySearchError,
	formatSearchResults,
	truncateForModel,
	WEB_FETCH_DESCRIPTION,
	WEB_SEARCH_DESCRIPTION,
	type WebFetchToolDetails,
	type WebSearchToolDetails,
} from "./src/format.js";
import { LocalUrlFallbackFetcher } from "./src/local-fetch.js";
import {
	HttpFetchError,
	KimiFetchUrlProvider,
	KimiWebSearchProvider,
	type UrlFetchResult,
	type WebSearchResult,
} from "./src/providers.js";

const WEB_SEARCH_TOOL_NAME = "web_search";
const WEB_FETCH_TOOL_NAME = "web_fetch";
const GATED_TOOL_NAMES = new Set([WEB_SEARCH_TOOL_NAME, WEB_FETCH_TOOL_NAME]);

export default function kimiWebToolsExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: WEB_SEARCH_TOOL_NAME,
		label: "Web Search (Kimi)",
		description: WEB_SEARCH_DESCRIPTION,
		promptSnippet: "Search the web for up-to-date information",
		promptGuidelines: [
			"Use web_search when you need up-to-date information from the internet, and follow up with web_fetch on the few most relevant result URLs.",
			"Cite sources from web_search results as inline markdown links in your answer.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "The query text to search for." }),
		}),

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const config = await resolveKimiWebServiceConfig(ctx);
			let results: WebSearchResult[];
			try {
				results = await new KimiWebSearchProvider(config).search(params.query, {
					toolCallId,
					signal,
				});
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") throw error;
				throw new Error(classifySearchError(error));
			}

			const text =
				results.length === 0
					? "No search results found."
					: truncateForModel(formatSearchResults(results));
			return {
				content: [{ type: "text", text }],
				details: { query: params.query, results } satisfies WebSearchToolDetails,
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			// pi renders the tool call while arguments are still streaming.
			const query = typeof args.query === "string" ? args.query : "";
			const preview = query.length > 60 ? `${query.slice(0, 60)}…` : query;
			text.setText(
				theme.fg("toolTitle", theme.bold(WEB_SEARCH_TOOL_NAME)) +
					" " +
					theme.fg("muted", `"${preview}"`),
			);
			return text;
		},

		renderResult(result, { expanded }, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as WebSearchToolDetails | undefined;
			if (!details) {
				text.setText(theme.fg("dim", "No search results found."));
				return text;
			}
			let output = theme.fg("success", `✓ ${details.results.length} result(s)`);
			if (expanded) {
				for (const item of details.results) {
					output += `\n  ${theme.fg("accent", item.title || item.url)}`;
					output += `\n    ${theme.fg("dim", item.url)}`;
				}
			}
			text.setText(output);
			return text;
		},
	});

	const localFallbackFetcher = new LocalUrlFallbackFetcher();

	pi.registerTool({
		name: WEB_FETCH_TOOL_NAME,
		label: "Web Fetch (Kimi)",
		description: WEB_FETCH_DESCRIPTION,
		promptSnippet: "Fetch and read the content of a web page URL",
		promptGuidelines: [
			"Use web_fetch to read the full content of a specific URL, for example one returned by web_search.",
			"Cite pages read via web_fetch as inline markdown links in your answer.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "The URL to fetch content from." }),
		}),

		async execute(toolCallId, params, signal, _onUpdate, ctx) {
			const config = await resolveKimiWebServiceConfig(ctx);
			let fetched: UrlFetchResult;
			try {
				fetched = await new KimiFetchUrlProvider(config, localFallbackFetcher).fetch(params.url, {
					toolCallId,
					signal,
				});
			} catch (error) {
				if (error instanceof Error && error.name === "AbortError") throw error;
				if (error instanceof HttpFetchError) {
					throw new Error(`Failed to fetch URL. ${error.message}`);
				}
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(`Failed to fetch URL due to network error: ${params.url}. ${message}`);
			}

			if (!fetched.content) {
				return {
					content: [{ type: "text", text: "The response body is empty." }],
					details: {
						url: params.url,
						kind: fetched.kind,
						byteLength: 0,
					} satisfies WebFetchToolDetails,
				};
			}

			const provenanceNote =
				fetched.kind === "passthrough"
					? "The returned content is the full response body, returned verbatim."
					: "The returned content is the main text extracted from the page.";
			const citeReminder =
				"If you use it in your answer, cite this page as a markdown link, e.g. [title](url).";
			const text = truncateForModel(`${provenanceNote} ${citeReminder}\n\n${fetched.content}`);

			return {
				content: [{ type: "text", text }],
				details: {
					url: params.url,
					kind: fetched.kind,
					byteLength: Buffer.byteLength(fetched.content, "utf8"),
				} satisfies WebFetchToolDetails,
			};
		},

		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			// pi renders the tool call while arguments are still streaming.
			const url = typeof args.url === "string" ? args.url : "";
			const preview = url.length > 70 ? `${url.slice(0, 70)}…` : url;
			text.setText(
				`${theme.fg("toolTitle", theme.bold(WEB_FETCH_TOOL_NAME))} ${theme.fg("muted", preview)}`,
			);
			return text;
		},

		renderResult(result, _options, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			const details = result.details as WebFetchToolDetails | undefined;
			if (!details) {
				text.setText(theme.fg("dim", "The response body is empty."));
				return text;
			}
			text.setText(
				theme.fg("success", `✓ Fetched ${formatSize(details.byteLength)}`) +
					" " +
					theme.fg("dim", `(${details.kind})`),
			);
			return text;
		},
	});

	async function syncToolAvailability(ctx: ExtensionContext): Promise<void> {
		const active = pi.getActiveTools();
		const shouldExpose = isKimiModel(ctx.model) && (await hasKimiCredential(ctx));
		const isExposed = active.includes(WEB_SEARCH_TOOL_NAME);

		if (shouldExpose === isExposed) return;
		if (shouldExpose) {
			pi.setActiveTools([...new Set([...active, ...GATED_TOOL_NAMES])]);
		} else {
			pi.setActiveTools(active.filter((name) => !GATED_TOOL_NAMES.has(name)));
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		await syncToolAvailability(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		await syncToolAvailability(ctx);
	});
}
