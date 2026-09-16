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

export const KIMI_PROVIDER_ID = "kimi-coding";

/** kimi-code's DEFAULT_KIMI_CODE_BASE_URL. */
const DEFAULT_KIMI_CODE_BASE_URL = "https://api.kimi.com/coding/v1";

export interface KimiWebServiceConfig {
	searchEndpoint: string;
	fetchEndpoint: string;
	headers: Record<string, string>;
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

/**
 * Undefined when the user is not authenticated. OAuth logins surface the
 * access token as an Authorization header on the resolved provider auth.
 */
export async function resolveKimiWebServiceConfig(
	ctx: ExtensionContext,
): Promise<KimiWebServiceConfig | undefined> {
	const providerAuth = await ctx.modelRegistry.getProviderAuth(KIMI_PROVIDER_ID);
	const { Authorization: oauthAuthorization, ...providerHeaders } = presentHeaders(
		providerAuth?.auth.headers,
	);

	const apiKey = providerAuth?.auth.apiKey?.trim();
	const authorization = apiKey ? `Bearer ${apiKey}` : oauthAuthorization;
	if (!authorization) return undefined;

	const baseUrl = resolveKimiCodeBaseUrl(providerAuth?.auth.baseUrl);
	return {
		searchEndpoint: `${baseUrl}/search`,
		fetchEndpoint: `${baseUrl}/fetch`,
		headers: { ...providerHeaders, Authorization: authorization },
	};
}

export function isKimiModel(model: Model<Api> | undefined): boolean {
	if (!model) return false;
	if (model.provider.toLowerCase().includes("kimi")) return true;
	const baseUrl = model.baseUrl.toLowerCase();
	return baseUrl.includes("api.kimi.com") || baseUrl.includes("api.moonshot.");
}
