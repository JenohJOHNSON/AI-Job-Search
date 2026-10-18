import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { checkBoards, crawlBoards, prettySlug } from "@/providers/board";
import { cleanText, fixedFetch } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderConfig, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

type GreenhouseJob = { id: number; title: string; absolute_url: string; updated_at?: string; first_published?: string; location?: { name?: string }; content?: string; departments?: { name?: string }[]; offices?: { name?: string }[] };
const hint = "Add Greenhouse board slugs in provider settings (the part after boards.greenhouse.io/).";

export class GreenhouseProvider implements JobProvider {
  id = "greenhouse"; private names = new Map<string, string>();
  constructor(private config: ProviderConfig) {}
  normalize(raw: unknown): NormalizedJob {
    const { job, board, company } = raw as { job: GreenhouseJob; board: string; company?: string };
    const published = job.first_published ?? job.updated_at;
    return normalizedJobSchema.parse({ source: this.id, sourceJobId: String(job.id), sourceUrl: job.absolute_url, applicationUrl: job.absolute_url, companyName: company || prettySlug(board), title: job.title, location: job.location?.name || "", descriptionRaw: job.content || "", descriptionClean: cleanText(job.content || ""), publishedAt: published ? new Date(published).toISOString() : null, extractor: "greenhouse_public_board_api", sourceMetadata: { board, departments: (job.departments ?? []).map(item => item.name).filter(Boolean) } });
  }
  private async companyName(board: string) {
    if (this.names.has(board)) return this.names.get(board)!;
    try { const data = await (await fixedFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}`, undefined, { retries: 1 })).json() as { name?: string }; this.names.set(board, data.name?.trim() || prettySlug(board)); } catch { this.names.set(board, prettySlug(board)); }
    return this.names.get(board)!;
  }
  private fetchBoard = async (board: string) => {
    const data = await (await fixedFetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`)).json() as { jobs?: GreenhouseJob[] };
    const company = await this.companyName(board);
    return (data.jobs ?? []).map(job => ({ job, board, company }));
  };
  async search(_request: SearchRequest): Promise<ProviderSearchResult> {
    return crawlBoards({ provider: this.id, boards: this.config.boards ?? [], rateLimitMs: this.config.rateLimitMs, emptyHint: hint, fetchBoard: this.fetchBoard, idOf: raw => String(raw.job.id), normalize: raw => this.normalize(raw) });
  }
  async fetchDetails(url: string) {
    const found = (await this.search({ queries: [], locations: [], remotePreferences: [], datePostedWindow: 30, maxJobs: 500 })).jobs.find(job => job.sourceUrl === url);
    if (!found) throw new ProviderError("NOT_FOUND", "Job not found on configured boards.", false); return found;
  }
  async healthCheck(): Promise<ProviderHealth> { return checkBoards({ boards: this.config.boards ?? [], rateLimitMs: this.config.rateLimitMs, emptyHint: hint, fetchBoard: board => this.fetchBoard(board) }); }
}
