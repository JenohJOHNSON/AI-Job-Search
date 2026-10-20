import type { NormalizedJob } from "@/lib/schemas";

/** `paidItems` caps how many results a pay-per-result source may fetch; it is the source's own "max jobs per run" setting. */
export type SearchRequest = { queries: string[]; locations: string[]; remotePreferences: string[]; datePostedWindow: number; maxJobs: number; contractTypes?: string[]; paidItems?: number };
export type ProviderConfig = { boards?: string[]; urls?: string[]; allowedHosts?: string[]; rateLimitMs?: number; strategies?: string[] };
export type ProviderHealth = { status: "HEALTHY" | "DEGRADED" | "FAILED" | "DISABLED"; detail: string };
// A scope is one complete listing (a board or career page). When a scope is fetched in full, vacancies missing from it can be marked as removed.
export type Coverage = { scope: string; sourceJobIds: string[] };
export type ProviderSearchResult = { jobs: NormalizedJob[]; stats: { fetched: number; valid: number; invalid: number; costUsd?: number }; warnings: string[]; coverage?: Coverage[] };
export interface JobProvider {
  id: string;
  search(request: SearchRequest): Promise<ProviderSearchResult>;
  fetchDetails(url: string): Promise<NormalizedJob>;
  normalize(raw: unknown): NormalizedJob;
  healthCheck(): Promise<ProviderHealth>;
  /** Optional: report whether previously discovered vacancies still exist (for search-based sources that cannot report coverage). */
  verify?(sourceJobIds: string[]): Promise<Record<string, "ACTIVE" | "GONE">>;
}
export class ProviderError extends Error {
  constructor(public code: "RATE_LIMIT" | "TIMEOUT" | "PARSER_CHANGED" | "BLOCKED" | "AUTH" | "NOT_FOUND" | "NETWORK" | "UNKNOWN", message: string, public retryable: boolean, public retryAfterMs?: number) { super(message); }
}
