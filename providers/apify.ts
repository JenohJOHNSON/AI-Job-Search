import { config } from "@/lib/config";
import type { NormalizedJob } from "@/lib/schemas";
import { sleep } from "@/providers/core";
import type { Portal } from "@/providers/portals";
import { ProviderError, type JobProvider, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

const API = "https://api.apify.com/v2";
const finished = new Set(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

export type ActorLimits = { maxItems: number; maxChargeUsd: number; timeoutSecs?: number; deadlineMs?: number };
export type ActorResult = { items: unknown[]; status: string; costUsd: number };
export type ApifyClient = {
  run(actor: string, input: Record<string, unknown>, limits: ActorLimits): Promise<ActorResult>;
  account(): Promise<{ username: string; plan?: string }>;
  actor(actor: string): Promise<{ title?: string }>;
};
type Run = { id: string; status: string; defaultDatasetId: string; statusMessage?: string; usageTotalUsd?: number };

function token() {
  const value = config().APIFY_API_TOKEN;
  if (!value) throw new ProviderError("AUTH", "APIFY_API_TOKEN is not configured; add your Apify API token to the web and worker services.", false);
  return value;
}

/** One Apify API call with bounded retries for 429/5xx/timeouts. Apify's own error message is kept so the user sees why a run was refused. */
async function call<T>(path: string, init: RequestInit = {}, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90_000);
    try {
      const response = await fetch(`${API}${path}`, { ...init, signal: controller.signal, headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json", ...init.headers } });
      const text = await response.text(); let body: unknown = null; try { body = text ? JSON.parse(text) : null; } catch { body = null; }
      if (response.ok) return body as T;
      const message = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${response.status}`;
      if (response.status === 401) throw new ProviderError("AUTH", `Apify rejected the API token: ${message}`, false);
      if (response.status === 402 || response.status === 403) throw new ProviderError("BLOCKED", `Apify refused the request: ${message}`, false);
      if (response.status === 404) throw new ProviderError("NOT_FOUND", `Apify: ${message}`, false);
      if (response.status === 429 || response.status >= 500) throw new ProviderError(response.status === 429 ? "RATE_LIMIT" : "NETWORK", `Apify: ${message}`, true);
      throw new ProviderError("UNKNOWN", `Apify: ${message}`, false);
    } catch (error) {
      const failure = error instanceof ProviderError ? error : (error as Error).name === "AbortError" ? new ProviderError("TIMEOUT", "Apify did not answer in time.", true) : new ProviderError("NETWORK", (error as Error).message, true);
      if (!failure.retryable || attempt >= retries) throw failure;
      await sleep(800 * 2 ** attempt);
    } finally { clearTimeout(timer); }
  }
}

const actorPath = (actor: string) => encodeURIComponent(actor.replace("/", "~"));

export const apifyClient: ApifyClient = {
  /**
   * Starts an actor with hard cost limits (`maxItems`, `maxTotalChargeUsd`), waits for it, and returns its dataset items.
   * A run that outlives the deadline is aborted so it stops billing; whatever it already collected is still returned.
   */
  async run(actor, input, limits) {
    const params = new URLSearchParams({ waitForFinish: "60", maxItems: String(limits.maxItems), maxTotalChargeUsd: limits.maxChargeUsd.toFixed(2), timeout: String(limits.timeoutSecs ?? 300) });
    let run = (await call<{ data: Run }>(`/acts/${actorPath(actor)}/runs?${params}`, { method: "POST", body: JSON.stringify(input) })).data;
    const deadline = Date.now() + (limits.deadlineMs ?? 420_000);
    while (!finished.has(run.status)) {
      if (Date.now() > deadline) { await call(`/actor-runs/${run.id}/abort`, { method: "POST" }).catch(() => undefined); run = { ...run, status: "ABORTED" }; break; }
      run = (await call<{ data: Run }>(`/actor-runs/${run.id}?waitForFinish=60`)).data;
    }
    const items = await call<unknown[]>(`/datasets/${run.defaultDatasetId}/items?clean=true&format=json&limit=${limits.maxItems}`);
    if (run.status === "FAILED" && !items.length) throw new ProviderError("PARSER_CHANGED", `The Apify actor ${actor} failed${run.statusMessage ? `: ${run.statusMessage}` : ""}.`, false);
    return { items: Array.isArray(items) ? items : [], status: run.status, costUsd: run.usageTotalUsd ?? 0 };
  },
  async account() { const data = (await call<{ data: { username?: string; plan?: { id?: string } } }>("/users/me")).data; return { username: data.username ?? "unknown", plan: data.plan?.id }; },
  async actor(actor) { const data = (await call<{ data: { title?: string } }>(`/acts/${actorPath(actor)}`)).data; return { title: data.title }; }
};

/**
 * A job portal read through a third-party Apify actor. Opt-in only: the portals' terms restrict automated collection, and every
 * run is billed to the owner's Apify account, so results are capped by the source's own "max jobs per run" setting.
 */
export class ApifyPortalProvider implements JobProvider {
  id: string;
  constructor(private portal: Portal, private client: ApifyClient = apifyClient) { this.id = portal.id; }
  normalize(raw: unknown): NormalizedJob { return this.portal.normalize(raw as Record<string, unknown>); }
  async search(request: SearchRequest): Promise<ProviderSearchResult> {
    const budget = Math.max(1, Math.min(request.paidItems ?? 25, 500));
    const runs = this.portal.runs(request, budget);
    if (!runs.length) return { jobs: [], stats: { fetched: 0, valid: 0, invalid: 0 }, warnings: [`No ${this.portal.name} search could be built: add target titles and places to a search profile${this.portal.id === "hellowork" ? " (HelloWork covers France only)" : ""}.`] };
    // Dollar cap per run: twice the list price per item plus start fees, rounded up to the cent (the epsilon absorbs float noise).
    const cap = (items: number) => Math.ceil((items * this.portal.usdPerItem * 2 + 0.05) * 100 - 1e-6) / 100;
    const settled = await Promise.allSettled(runs.map(run => this.client.run(this.portal.actor, run.input, { maxItems: run.maxItems, maxChargeUsd: cap(run.maxItems) })));
    const failures = settled.flatMap((result, index) => result.status === "rejected" ? [{ label: runs[index]!.label, error: result.reason as Error }] : []);
    if (failures.length === settled.length) throw failures[0]!.error;
    const jobs = new Map<string, NormalizedJob>(); const warnings = failures.map(failure => `${failure.label}: ${failure.error.message}`);
    let fetched = 0, invalid = 0, cost = 0;
    settled.forEach((result, index) => {
      if (result.status !== "fulfilled") return;
      cost += result.value.costUsd;
      if (result.value.status !== "SUCCEEDED") warnings.push(`${runs[index]!.label}: the Apify run ended as ${result.value.status}; partial results were kept.`);
      for (const item of result.value.items) { fetched++; try { const job = this.normalize(item); if (!jobs.has(job.sourceUrl)) jobs.set(job.sourceUrl, job); } catch { invalid++; } }
    });
    const list = [...jobs.values()].slice(0, request.maxJobs);
    return { jobs: list, stats: { fetched, valid: list.length, invalid, costUsd: Math.round(cost * 10_000) / 10_000 }, warnings };
  }
  async fetchDetails(): Promise<NormalizedJob> { throw new ProviderError("NOT_FOUND", `${this.portal.name} postings are only collected during a search run.`, false); }
  /** Free check: validates the token and that the actor exists, without starting a billed run. */
  async healthCheck(): Promise<ProviderHealth> {
    try {
      const account = await this.client.account(); const actor = await this.client.actor(this.portal.actor);
      return { status: "HEALTHY", detail: `Apify account ${account.username}${account.plan ? ` (${account.plan} plan)` : ""}; actor ${this.portal.actor}${actor.title ? ` (“${actor.title}”)` : ""} is available. Each search run is billed to this account, about $${this.portal.usdPerItem} per job.` };
    } catch (error) {
      const code = error instanceof ProviderError ? error.code : "UNKNOWN";
      return { status: code === "AUTH" || code === "NOT_FOUND" ? "FAILED" : "DEGRADED", detail: (error as Error).message };
    }
  }
}
