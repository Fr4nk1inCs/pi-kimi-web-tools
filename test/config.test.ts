import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { isKimiModel, normalizeKimiCodeBaseUrl, presentHeaders } from "../src/config.js";

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
