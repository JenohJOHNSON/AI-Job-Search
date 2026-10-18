import { normalizedJobSchema, type NormalizedJob } from "@/lib/schemas";
import { checkBoards, crawlBoards, prettySlug } from "@/providers/board";
import { cleanText, fixedFetch } from "@/providers/core";
import { ProviderError, type JobProvider, type ProviderConfig, type ProviderHealth, type ProviderSearchResult, type SearchRequest } from "@/providers/types";

type AshbyJob = {
  id: string; title: string; jobUrl: string; applyUrl?: string; location?: string; secondaryLocations?: { location?: string }[]; isRemote?: boolean; workplaceType?: string;
  employmentType?: string; descriptionPlain?: string; descriptionHtml?: string; publishedAt?: string; isListed?: boolean; team?: string; department?: string;
  compensation?: { summaryComponents?: { compensationType?: string; interval?: string; currencyCode?: string; minValue?: number; maxValue?: number }[] };
};
const hint = "Add Ashby board names in provider settings (the part after jobs.ashbyhq.com/).";
const employment: Record<string, string> = { FullTime: "Full time", PartTime: "Part time", Contract: "Contract", Intern: "Internship", Temporary: "Temporary" };

export class AshbyProvider implements JobProvider {
  id = "ashby"; constructor(private config: ProviderConfig) {}
  normalize(raw: unknown): NormalizedJob {
    const { job, board } = raw as { job: AshbyJob; board: string }; const type = job.workplaceType?.toLowerCase();
    const salary = job.compensation?.summaryComponents?.find(item => item.compensationType === "Salary" && /year/i.test(item.interval ?? "") && item.minValue && item.maxValue);
    const locations = [job.location, ...(job.secondaryLocations ?? []).map(item => item.location)].filter(Boolean).join("; ");
    const description = job.descriptionPlain || cleanText(job.descriptionHtml || "");
    return normalizedJobSchema.parse({ source: this.id, sourceJobId: job.id, sourceUrl: job.jobUrl, applicationUrl: job.applyUrl || job.jobUrl, companyName: prettySlug(board), title: job.title, location: locations, remoteType: type === "remote" || (job.isRemote && !type) ? "REMOTE" : type === "hybrid" ? "HYBRID" : type === "onsite" ? "ONSITE" : "UNKNOWN", contractType: (job.employmentType && employment[job.employmentType]) || job.employmentType || "UNKNOWN", salaryMin: salary ? Math.round(salary.minValue!) : null, salaryMax: salary ? Math.round(salary.maxValue!) : null, salaryCurrency: salary?.currencyCode?.length === 3 ? salary.currencyCode : "EUR", descriptionRaw: job.descriptionHtml || description, descriptionClean: description, publishedAt: job.publishedAt ? new Date(job.publishedAt).toISOString() : null, extractor: "ashby_public_job_board_api", sourceMetadata: { board, team: job.team ?? job.department } });
  }
  private fetchBoard = async (board: string) => {
    const data = await (await fixedFetch(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`)).json() as { jobs?: AshbyJob[] };
    return (data.jobs ?? []).filter(job => job.isListed !== false).map(job => ({ job, board }));
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
