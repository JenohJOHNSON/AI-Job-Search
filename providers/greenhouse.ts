import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { cleanText, fixedFetch, jobMatches, publishedRecently } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderConfig, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

type GreenhouseJob = { id: number; title: string; absolute_url: string; updated_at?: string; location?: { name?: string }; content?: string; metadata?: { name: string; value: unknown }[] };
export class GreenhouseProvider implements JobProvider {
  id = "greenhouse"; constructor(private config: ProviderConfig) {}
  normalize(raw: unknown): NormalizedJob {
    const { job, board } = raw as { job: GreenhouseJob; board: string };
    return normalizedJobSchema.parse({ source: this.id, sourceJobId: String(job.id), sourceUrl: job.absolute_url, applicationUrl: job.absolute_url, companyName: board, title: job.title, location: job.location?.name || "France", descriptionRaw: job.content || "", descriptionClean: cleanText(job.content || ""), publishedAt: job.updated_at ? new Date(job.updated_at).toISOString() : null, extractor: "greenhouse_public_board_api", sourceMetadata: { board } });
  }
  async search(request: SearchRequest): Promise<ProviderSearchResult> {
    const jobs: NormalizedJob[] = []; let fetched = 0; let invalid = 0; const warnings: string[] = [];
    for (const board of this.config.boards ?? []) {
      try {
        const response = await fixedFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`); const data = await response.json() as { jobs?: GreenhouseJob[] };
        for (const raw of data.jobs ?? []) { fetched++; try { const job = this.normalize({ job: raw, board }); if (jobMatches(`${job.title} ${job.location} ${job.descriptionClean}`, request.queries, request.locations) && publishedRecently(job.publishedAt, request.datePostedWindow)) jobs.push(job); } catch { invalid++; } if (jobs.length >= request.maxJobs) break; }
      } catch (error) { warnings.push(`${board}: ${(error as Error).message}`); }
      if (jobs.length >= request.maxJobs) break;
    }
    if (!this.config.boards?.length) warnings.push("Add Greenhouse board slugs in provider settings.");
    return { jobs, stats: { fetched, valid: jobs.length, invalid }, warnings };
  }
  async fetchDetails(url: string) { const found = (await this.search({ queries: [], locations: [], remotePreferences: [], datePostedWindow: 30, maxJobs: 500 })).jobs.find(job => job.sourceUrl === url); if (!found) throw new ProviderError("PARSER_CHANGED", "Job not found on configured boards.", false); return found; }
  async healthCheck(): Promise<ProviderHealth> { return { status: this.config.boards?.length ? "HEALTHY" : "DEGRADED", detail: this.config.boards?.length ? "Public board API configured." : "No board slugs configured." }; }
}
