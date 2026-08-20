import { describe, expect, it } from "vitest";

import { classifySearchError, formatSearchResults } from "../src/format.js";
import { extractMainContent } from "../src/local-fetch.js";

describe("formatSearchResults", () => {
	it("renders all fields and the citation reminder", () => {
		const output = formatSearchResults([
			{
				title: "Node.js",
				url: "https://nodejs.org",
				snippet: "Runtime",
				siteName: "nodejs.org",
				date: "2026-08-01",
			},
		]);
		expect(output).toContain("Title: Node.js");
		expect(output).toContain("Site: nodejs.org");
		expect(output).toContain("Date: 2026-08-01");
		expect(output).toContain("URL: https://nodejs.org");
		expect(output).toContain("Snippet: Runtime");
		expect(output).toContain("cite it inline as a markdown link");
	});

	it("omits optional fields when absent and separates results with ---", () => {
		const output = formatSearchResults([
			{ title: "A", url: "https://a.example", snippet: "a" },
			{ title: "B", url: "https://b.example", snippet: "b" },
		]);
		expect(output).not.toContain("Site:");
		expect(output).not.toContain("Date:");
		expect(output).toContain("\n---\n\n");
	});
});

describe("classifySearchError", () => {
	it("categorizes aborts, timeouts, auth, and network errors", () => {
		expect(classifySearchError(new Error("The operation was aborted"))).toMatch(
			/^Search cancelled:/,
		);
		expect(classifySearchError(new Error("request timed out"))).toMatch(/^Search timed out:/);
		expect(classifySearchError(new Error("HTTP 401"))).toMatch(
			/^Search failed \(authentication\):/,
		);
		expect(classifySearchError(new TypeError("fetch failed"))).toMatch(
			/^Search failed \(network\):/,
		);
	});

	it("preserves the original message and falls back to a generic category", () => {
		expect(classifySearchError(new Error("something odd happened"))).toBe(
			"Search failed: something odd happened",
		);
		expect(classifySearchError("plain string")).toBe("Search failed: plain string");
	});
});

describe("extractMainContent", () => {
	it("extracts the main article text with a markdown title", () => {
		const html = `<html><head><title>Page</title></head><body>
			<article><h1>Article Title</h1><p>${"Substantive paragraph. ".repeat(20)}</p></article>
		</body></html>`;
		const output = extractMainContent(html);
		expect(output).toContain("Substantive paragraph.");
	});

	it("falls back to body text when Readability finds nothing", () => {
		const output = extractMainContent("<html><body>hello world</body></html>");
		expect(output).toContain("hello world");
	});

	it("throws for pages with no meaningful content", () => {
		expect(() => extractMainContent("<html><body>   </body></html>")).toThrow(/Failed to extract/);
	});
});
