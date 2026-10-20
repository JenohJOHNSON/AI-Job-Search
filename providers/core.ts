import { Resolver } from "node:dns/promises";
import * as cheerio from "cheerio";
import https from "node:https";
import ipaddr from "ipaddr.js";
import { ProviderError } from "@/providers/types";

const maximumBytes = 3_000_000;
function publicIp(address: string) {
  const parsed = ipaddr.parse(address); const range = parsed.range();
  return !["private", "loopback", "linkLocal", "uniqueLocal", "unspecified", "reserved", "broadcast", "carrierGradeNat", "multicast"].includes(range);
}
const blockTags = "p,div,li,ul,ol,tr,table,section,article,h1,h2,h3,h4,h5,h6,blockquote,pre";
/** Converts vacancy HTML to readable plain text. Greenhouse sends HTML entity-escaped (`&lt;p&gt;`), so that is unescaped first. */
export function cleanText(value: string) {
  if (!value) return "";
  let html = value;
  if (!html.includes("<") && /&lt;|&#60;|&#x3c;/i.test(html)) html = cheerio.load(`<div>${html}</div>`).text();
  const $ = cheerio.load(`<div id="root">${html}</div>`);
  $("script,style,noscript").remove(); $("br").replaceWith("\n"); $("li").each((_i, element) => { $(element).prepend("- "); });
  $(blockTags).each((_i, element) => { $(element).append("\n"); });
  return $("#root").text().replace(/ /g, " ").split("\n").map(line => line.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function allowedHost(hostname: string, allowedHosts: string[]) { return allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`)); }
export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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

async function fetchOnce(url: string, init?: RequestInit) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, headers: { "User-Agent": "ElanJobSearch/0.2 (+personal job search; respects robots and rate limits)", Accept: "application/json", ...init?.headers } });
    if (response.status === 401 || response.status === 403) throw new ProviderError("AUTH", `Provider rejected the request (HTTP ${response.status}).`, false);
    if (response.status === 404) throw new ProviderError("NOT_FOUND", "Provider returned 404. Check the board slug or URL.", false);
    if (response.status === 429) { const wait = Number(response.headers.get("retry-after")); throw new ProviderError("RATE_LIMIT", "Provider rate limit reached.", true, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 30) * 1000 : undefined); }
    if (!response.ok) throw new ProviderError(response.status >= 500 ? "NETWORK" : "PARSER_CHANGED", `Provider returned HTTP ${response.status}.`, response.status >= 500);
    return response;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if ((error as Error).name === "AbortError") throw new ProviderError("TIMEOUT", "Provider timed out.", true);
    throw new ProviderError("NETWORK", (error as Error).message, true);
  } finally { clearTimeout(timer); }
}

/** GET/POST with bounded retries (default 2) and exponential backoff for timeouts, 429 and 5xx. Never retries auth, 404 or other client errors. */
export async function fixedFetch(url: string, init?: RequestInit, options: { retries?: number; baseDelayMs?: number } = {}) {
  const retries = options.retries ?? 2; const base = options.baseDelayMs ?? 600;
  for (let attempt = 0; ; attempt++) {
    try { return await fetchOnce(url, init); }
    catch (error) {
      if (!(error instanceof ProviderError) || !error.retryable || attempt >= retries) throw error;
      await sleep(error.retryAfterMs ?? base * 2 ** attempt + Math.floor(Math.random() * 150));
    }
  }
}
