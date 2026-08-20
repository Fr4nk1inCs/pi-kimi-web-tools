import { describe, expect, it } from "vitest";

import { assertPublicFetchTarget, isBlockedAddress } from "../src/local-fetch.js";

describe("isBlockedAddress", () => {
	it("blocks private / loopback / link-local IPv4 ranges", () => {
		for (const address of [
			"0.1.2.3",
			"10.0.0.1",
			"100.64.0.1",
			"127.0.0.1",
			"169.254.169.254",
			"172.16.0.1",
			"192.168.1.1",
		]) {
			expect(isBlockedAddress(address), address).toBe(true);
		}
	});

	it("blocks loopback / ULA / link-local IPv6, including zone ids", () => {
		expect(isBlockedAddress("::1")).toBe(true);
		expect(isBlockedAddress("fc00::1")).toBe(true);
		expect(isBlockedAddress("fe80::1%en0")).toBe(true);
	});

	it("allows public addresses and non-IP strings", () => {
		expect(isBlockedAddress("93.184.216.34")).toBe(false);
		expect(isBlockedAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
		expect(isBlockedAddress("example.com")).toBe(false);
	});
});

describe("assertPublicFetchTarget", () => {
	it("accepts public http(s) URLs with IP literals (no DNS needed)", async () => {
		await expect(assertPublicFetchTarget("https://93.184.216.34/page")).resolves.toBeUndefined();
		await expect(assertPublicFetchTarget("http://93.184.216.34")).resolves.toBeUndefined();
	});

	it("rejects non-http(s) schemes", async () => {
		await expect(assertPublicFetchTarget("file:///etc/passwd")).rejects.toThrow(/scheme/);
		await expect(assertPublicFetchTarget("ftp://93.184.216.34/x")).rejects.toThrow(/scheme/);
	});

	it("rejects invalid URLs", async () => {
		await expect(assertPublicFetchTarget("not a url")).rejects.toThrow(/Invalid URL/);
	});

	it("rejects private IP literals, including cloud metadata", async () => {
		await expect(
			assertPublicFetchTarget("http://169.254.169.254/latest/meta-data"),
		).rejects.toThrow(/private address/);
		await expect(assertPublicFetchTarget("http://127.0.0.1:8080/")).rejects.toThrow(
			/private address/,
		);
		await expect(assertPublicFetchTarget("http://[::1]/")).rejects.toThrow(/private address/);
	});

	it("rejects localhost hostnames without hitting DNS", async () => {
		await expect(assertPublicFetchTarget("http://localhost:3000/")).rejects.toThrow(/private host/);
		await expect(assertPublicFetchTarget("http://app.localhost/")).rejects.toThrow(/private host/);
	});
});
