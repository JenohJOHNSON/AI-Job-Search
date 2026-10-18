import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { checkBoards, crawlBoards, prettySlug } from "@/providers/board";
import { cleanText, fixedFetch } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderConfig, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

type LeverJob = {
  id: string; text: string; hostedUrl: string; applyUrl?: string; createdAt?: number; descriptionPlain?: string; description?: string;
  lists?: { text?: string; content?: string }[]; additionalPlain?: string; additional?: string; workplaceType?: string; country?: string;
  categories?: { location?: string; commitment?: string; team?: string; department?: string; allLocations?: string[] };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
};
const hint = "Add Lever site slugs in provider settings (the part after jobs.lever.co/).";
const hosts = ["https://api.lever.co", "https://api.eu.lever.co"];

export class LeverProvider implements JobProvider {
  id = "lever"; constructor(private config: ProviderConfig) {}
  normalize(raw: unknown): NormalizedJob {
    const { job, board } = raw as { job: LeverJob; board: string }; const workplace = job.workplaceType?.toLowerCase();
    // Lever keeps requirements and responsibilities in `lists`; they are essential for skill matching.
    const sections = [job.descriptionPlain || cleanText(job.description || ""), ...(job.lists ?? []).map(list => `${list.text ?? ""}\n${cleanText(list.content ?? "")}`.trim()), job.additionalPlain || cleanText(job.additional ?? "")].filter(Boolean);
    const yearly = job.salaryRange?.interval === "per-year-salary" && job.salaryRange.min && job.salaryRange.max;
    const locations = job.categories?.allLocations?.length ? job.categories.allLocations.join("; ") : job.categories?.location || "";
    return normalizedJobSchema.parse({ source: this.id, sourceJobId: job.id, sourceUrl: job.hostedUrl, applicationUrl: job.applyUrl || job.hostedUrl, companyName: prettySlug(board), title: job.text, location: locations, remoteType: workplace === "remote" ? "REMOTE" : workplace === "hybrid" ? "HYBRID" : workplace === "on-site" || workplace === "onsite" ? "ONSITE" : "UNKNOWN", contractType: job.categories?.commitment || "UNKNOWN", salaryMin: yearly ? Math.round(job.salaryRange!.min!) : null, salaryMax: yearly ? Math.round(job.salaryRange!.max!) : null, salaryCurrency: yearly && job.salaryRange!.currency?.length === 3 ? job.salaryRange!.currency : "EUR", descriptionRaw: sections.join("\n\n"), descriptionClean: sections.join("\n\n"), publishedAt: job.createdAt ? new Date(job.createdAt).toISOString() : null, extractor: "lever_public_postings_api", sourceMetadata: { board, team: job.categories?.team ?? job.categories?.department } });
  }
  /** Lever hosts European customers on a separate API origin, so a 404 on the global origin falls back to it. */
  private fetchBoard = async (board: string) => {
    let lastError: unknown;
    for (const host of hosts) {
      try { return ((await (await fixedFetch(`${host}/v0/postings/${encodeURIComponent(board)}?mode=json`)).json()) as LeverJob[]).map(job => ({ job, board })); }
      catch (error) { lastError = error; if (!(error instanceof ProviderError && error.code === "NOT_FOUND")) throw error; }
    }
    throw lastError;
  };
  async search(_request: SearchRequest): Promise<ProviderSearchResult> {
    return crawlBoards({ provider: this.id, boards: this.config.boards ?? [], rateLimitMs: this.config.rateLimitMs, emptyHint: hint, fetchBoard: this.fetchBoard, idOf: raw => raw.job.id, normalize: raw => this.normalize(raw) });
  }
  async fetchDetails(url: string) {
    const job = (await this.search({ queries: [], locations: [], remotePreferences: [], datePostedWindow: 30, maxJobs: 500 })).jobs.find(item => item.sourceUrl === url);
    if (!job) throw new ProviderError("NOT_FOUND", "Job not found.", false); return job;
  }
  async healthCheck(): Promise<ProviderHealth> { return checkBoards({ boards: this.config.boards ?? [], rateLimitMs: this.config.rateLimitMs, emptyHint: hint, fetchBoard: board => this.fetchBoard(board) }); }
}
