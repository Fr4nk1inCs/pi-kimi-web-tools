import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";

import kimiWebToolsExtension from "../index.js";

type ToolDef = Parameters<ExtensionAPI["registerTool"]>[0];

function registerExtension(): Map<string, ToolDef> {
	const tools = new Map<string, ToolDef>();
	const pi = {
		registerTool: (def: ToolDef) => tools.set(def.name, def),
		getActiveTools: () => [] as string[],
		setActiveTools: () => {},
		on: () => {},
	};
	kimiWebToolsExtension(pi as unknown as ExtensionAPI);
	return tools;
}

type RequiredToolDef = ToolDef & {
	renderCall: NonNullable<ToolDef["renderCall"]>;
	execute: NonNullable<ToolDef["execute"]>;
};

function mustGet(tools: Map<string, ToolDef>, name: string): RequiredToolDef {
	const tool = tools.get(name);
	if (!tool?.renderCall || !tool.execute) throw new Error(`tool not registered: ${name}`);
	return tool as RequiredToolDef;
}

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
const fakeCtx = {
	modelRegistry: {
		getProviderAuth: async () => ({ auth: { apiKey: "test-key" }, source: "test" }),
	},
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("tool registration", () => {
	it("registers web_search and web_fetch", () => {
		const tools = registerExtension();
		expect([...tools.keys()].sort()).toEqual(["web_fetch", "web_search"]);
	});

	it("renderCall tolerates partially streamed arguments", () => {
		const tools = registerExtension();
		for (const name of ["web_search", "web_fetch"]) {
			const tool = mustGet(tools, name);
			expect(() => tool.renderCall({} as never, theme as never, {} as never)).not.toThrow();
		}
	});

	it("web_search rethrows caller aborts instead of classifying them", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new DOMException("The operation was aborted", "AbortError");
		});
		const tool = mustGet(registerExtension(), "web_search");
		const error = await tool
			.execute("call-1", { query: "q" } as never, undefined, undefined, fakeCtx as never)
			.catch((e: unknown) => e);
		expect((error as Error).name).toBe("AbortError");
	});

	it("web_fetch rethrows caller aborts instead of wrapping them", async () => {
		vi.stubGlobal("fetch", async () => {
			throw new DOMException("The operation was aborted", "AbortError");
		});
		const tool = mustGet(registerExtension(), "web_fetch");
		const error = await tool
			.execute(
				"call-1",
				{ url: "http://93.184.216.34/" } as never,
				undefined,
				undefined,
				fakeCtx as never,
			)
			.catch((e: unknown) => e);
		expect((error as Error).name).toBe("AbortError");
	});
});
