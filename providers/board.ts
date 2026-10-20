import type { NormalizedJob } from "@/lib/schemas";
import { sleep } from "@/providers/core";
import { ProviderError, type Coverage, type ProviderHealth, type ProviderSearchResult } from "@/providers/types";

export type BoardCrawl<T> = {
  provider: string;
  boards: string[];
  rateLimitMs?: number;
  maxPerBoard?: number;
  emptyHint: string;
  fetchBoard(board: string): Promise<T[]>;
  idOf(raw: T): string;
  normalize(raw: T, board: string): NormalizedJob;
};

export const prettySlug = (slug: string) => slug.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase()).trim();

/**
 * Fetches every listed vacancy of every configured board. Relevance is decided later by the matching engine,
 * so the full listing is returned; that also makes each board a complete "scope" for removal detection.
 * A failing board is reported as a warning and never stops the others.
 */
export async function crawlBoards<T>(crawl: BoardCrawl<T>): Promise<ProviderSearchResult> {
  const jobs: NormalizedJob[] = []; const coverage: Coverage[] = []; const warnings: string[] = [];
  let fetched = 0, invalid = 0;
  if (!crawl.boards.length) warnings.push(crawl.emptyHint);
  for (const [index, board] of crawl.boards.entries()) {
    if (index > 0 && crawl.rateLimitMs) await sleep(crawl.rateLimitMs);
    try {
      const raws = (await crawl.fetchBoard(board)).slice(0, crawl.maxPerBoard ?? 1_000); const scope = `${crawl.provider}:${board.toLowerCase()}`;
      const ids: string[] = [];
      for (const raw of raws) {
        fetched++; ids.push(crawl.idOf(raw));
        try { jobs.push({ ...crawl.normalize(raw, board), scope }); } catch { invalid++; }
      }
      coverage.push({ scope, sourceJobIds: ids });
      if (!raws.length) warnings.push(`${board}: the board is reachable but lists no openings.`);
    } catch (error) { warnings.push(`${board}: ${(error as Error).message}`); }
  }
  return { jobs, stats: { fetched, valid: jobs.length, invalid }, warnings, coverage };
}

/** Real connectivity check: requests each board once and reports counts or the first error. */
export async function checkBoards<T>(crawl: Pick<BoardCrawl<T>, "boards" | "fetchBoard" | "emptyHint" | "rateLimitMs">): Promise<ProviderHealth> {
  if (!crawl.boards.length) return { status: "DEGRADED", detail: crawl.emptyHint };
  const results: string[] = []; let failed = 0;
  for (const [index, board] of crawl.boards.entries()) {
    if (index > 0 && crawl.rateLimitMs) await sleep(crawl.rateLimitMs);
    try { results.push(`${board}: ${(await crawl.fetchBoard(board)).length} openings`); }
    catch (error) { failed++; results.push(`${board}: ${error instanceof ProviderError ? error.message : (error as Error).message}`); }
  }
  return { status: failed === crawl.boards.length ? "FAILED" : failed ? "DEGRADED" : "HEALTHY", detail: results.join("; ") };
}
