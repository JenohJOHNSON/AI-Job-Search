import { Resolver } from "node:dns/promises";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { ProviderError } from "@/providers/types";

const maximumBytes = 3_000_000;
function publicIp(address: string) {
  const parsed = ipaddr.parse(address); const range = parsed.range();
  return !["private", "loopback", "linkLocal", "uniqueLocal", "unspecified", "reserved", "broadcast", "carrierGradeNat", "multicast"].includes(range);
}
export function cleanText(value: string) { return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim(); }
export function allowedHost(hostname: string, allowedHosts: string[]) { return allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`)); }

export async function safePublicFetch(input: string, allowedHosts: string[], redirects = 0): Promise<{ body: string; url: string; status: number }> {
  if (redirects > 3) throw new ProviderError("NETWORK", "Too many redirects.", false);
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || !allowedHost(url.hostname, allowedHosts)) throw new ProviderError("BLOCKED", "URL is outside the configured public hosts.", false);
  const resolver = new Resolver(); const addresses = await resolver.resolve4(url.hostname).catch(() => []);
  const address6 = await resolver.resolve6(url.hostname).catch(() => []); const resolved = [...addresses, ...address6];
  if (!resolved.length || resolved.some(address => !publicIp(address))) throw new ProviderError("BLOCKED", "Host does not resolve exclusively to public addresses.", false);
  const selected = resolved[0]!;
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: "GET", headers: { "User-Agent": "ElanJobSearch/0.1 (+responsible-public-fetch)", Accept: "application/json,text/html;q=0.9" }, timeout: 15_000, lookup: (_host, _options, callback) => callback(null, selected, ipaddr.parse(selected).kind() === "ipv6" ? 6 : 4) }, response => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) { response.resume(); void safePublicFetch(new URL(response.headers.location, url).toString(), allowedHosts, redirects + 1).then(resolve, reject); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > maximumBytes) request.destroy(new Error("Response too large.")); else chunks.push(chunk); });
      response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), url: url.toString(), status }));
    });
    request.on("timeout", () => request.destroy(new ProviderError("TIMEOUT", "Provider timed out.", true)));
    request.on("error", error => reject(error instanceof ProviderError ? error : new ProviderError("NETWORK", error.message, true)));
    request.end();
  });
}

export async function fixedFetch(url: string, init?: RequestInit) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": "ElanJobSearch/0.1", ...init?.headers } });
    if (response.status === 401 || response.status === 403) throw new ProviderError("AUTH", "Provider authentication was rejected.", false);
    if (response.status === 429) throw new ProviderError("RATE_LIMIT", "Provider rate limit reached.", true);
    if (!response.ok) throw new ProviderError(response.status >= 500 ? "NETWORK" : "PARSER_CHANGED", `Provider returned HTTP ${response.status}.`, response.status >= 500);
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if ((error as Error).name === "AbortError") throw new ProviderError("TIMEOUT", "Provider timed out.", true);
    throw new ProviderError("NETWORK", (error as Error).message, true);
  } finally { clearTimeout(timer); }
}

export function jobMatches(text: string, queries: string[], locations: string[]) {
  const normalized = text.toLowerCase();
  const queryMatch = !queries.length || queries.some(query => normalized.includes(query.toLowerCase()));
  const locationMatch = !locations.length || locations.some(location => normalized.includes(location.toLowerCase()));
  return queryMatch && locationMatch;
}
export function publishedRecently(publishedAt: string | null, days: number) { return !publishedAt || new Date(publishedAt).getTime() >= Date.now() - days * 86_400_000; }
