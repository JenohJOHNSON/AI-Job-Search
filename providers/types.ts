import type { NormalizedJob } from "@/lib/schemas";

export type SearchRequest = { queries: string[]; locations: string[]; remotePreferences: string[]; datePostedWindow: number; maxJobs: number };
export type ProviderConfig = { boards?: string[]; urls?: string[]; allowedHosts?: string[]; rateLimitMs?: number; strategies?: string[] };
export type ProviderHealth = { status: "HEALTHY" | "DEGRADED" | "FAILED" | "DISABLED"; detail: string };
export type ProviderSearchResult = { jobs: NormalizedJob[]; stats: { fetched: number; valid: number; invalid: number }; warnings: string[] };
export interface JobProvider {
  id: string;
  search(request: SearchRequest): Promise<ProviderSearchResult>;
  fetchDetails(url: string): Promise<NormalizedJob>;
  normalize(raw: unknown): NormalizedJob;
  healthCheck(): Promise<ProviderHealth>;
}
export class ProviderError extends Error {
  constructor(public code: "RATE_LIMIT" | "TIMEOUT" | "PARSER_CHANGED" | "BLOCKED" | "AUTH" | "NETWORK" | "UNKNOWN", message: string, public retryable: boolean) { super(message); }
}
