import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Api, Model } from "@earendil-works/pi-ai";

/** pi uses null to suppress a default header value. */
export function presentHeaders(
	headers: Record<string, string | null> | undefined,
): Record<string, string> {
	const present: Record<string, string> = {};
	for (const [name, value] of Object.entries(headers ?? {})) {
		if (value !== null) present[name] = value;
	}
	return present;
}

const KIMI_PROVIDER_ID = "kimi-coding";

/** kimi-code's DEFAULT_KIMI_CODE_BASE_URL. */
const DEFAULT_KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";

export interface KimiWebServiceConfig {
	searchEndpoint: string;
	fetchEndpoint: string;
	apiKey: string;
	providerHeaders: Record<string, string>;
}

/** pi stores the provider root as `…/coding`; the web services live under `…/coding/v1`. */
export function normalizeKimiCodeBaseUrl(raw: string): string {
	const trimmed = raw.replace(/\/+$/, "");
	if (trimmed.endsWith("/coding")) return `${trimmed}/v1`;
	return trimmed;
}

function resolveKimiCodeBaseUrl(providerBaseUrl: string | undefined): string {
	const envOverride = process.env.KIMI_CODE_BASE_URL?.trim();
	if (envOverride) return normalizeKimiCodeBaseUrl(envOverride);
	if (providerBaseUrl) return normalizeKimiCodeBaseUrl(providerBaseUrl);
	return DEFAULT_KIMI_CODE_BASE_URL;
}

export async function resolveKimiWebServiceConfig(
	ctx: ExtensionContext,
): Promise<KimiWebServiceConfig> {
	const providerAuth = await ctx.modelRegistry.getProviderAuth(KIMI_PROVIDER_ID);

	const envKey = process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim();
	const apiKey = envKey || providerAuth?.auth.apiKey?.trim();
	if (!apiKey) {
		throw new Error(
			"Kimi web tools are not configured: no API key found. " +
				`Run /login and sign in to "${KIMI_PROVIDER_ID}", or set KIMI_API_KEY.`,
		);
	}

	const baseUrl = resolveKimiCodeBaseUrl(providerAuth?.auth.baseUrl);
	return {
		searchEndpoint: `${baseUrl}/search`,
		fetchEndpoint: `${baseUrl}/fetch`,
		apiKey,
		providerHeaders: presentHeaders(providerAuth?.auth.headers),
	};
}

export function isKimiModel(model: Model<Api> | undefined): boolean {
	if (!model) return false;
	if (model.provider.toLowerCase().includes("kimi")) return true;
	const baseUrl = model.baseUrl.toLowerCase();
	return baseUrl.includes("api.kimi.com") || baseUrl.includes("api.moonshot.");
}

export async function hasKimiCredential(ctx: ExtensionContext): Promise<boolean> {
	if (process.env.KIMI_API_KEY?.trim() || process.env.MOONSHOT_API_KEY?.trim()) return true;
	const providerAuth = await ctx.modelRegistry.getProviderAuth(KIMI_PROVIDER_ID);
	return Boolean(providerAuth?.auth.apiKey?.trim());
}
