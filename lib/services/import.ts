import { HttpError } from "@/lib/api";
import type { NormalizedJob } from "@/lib/schemas";
import { GenericProvider } from "@/providers/generic";
import { ProviderError } from "@/providers/types";

// Platforms whose terms forbid automated retrieval or that sit behind login/anti-bot controls. Élan never fetches them:
// the owner pastes the posting instead (manual import), keeping the original URL as the application link.
const restricted = ["linkedin.com", "indeed.", "hellowork.com", "apec.fr", "welcometothejungle.com", "jobijoba.com", "cadremploi.fr", "glassdoor.", "monster.", "meteojob.com", "talent.com", "jobteaser.com", "staffsante.fr"];
export const restrictedPlatform = (hostname: string) => restricted.find(item => hostname === item || hostname.endsWith(`.${item}`) || (item.endsWith(".") && hostname.split(".").includes(item.slice(0, -1))));

/** Imports vacancies from one user-supplied career-page URL that publishes schema.org JobPosting data and allows access via robots.txt. */
export async function importFromUrl(rawUrl: string, limit = 25): Promise<NormalizedJob[]> {
  let url: URL; try { url = new URL(rawUrl); } catch { throw new HttpError(400, "Enter a valid URL."); }
  if (url.protocol !== "https:") throw new HttpError(400, "Only HTTPS career pages can be imported.");
  const blocked = restrictedPlatform(url.hostname);
  if (blocked) throw new HttpError(422, `${url.hostname} does not permit automated retrieval, so Élan will not fetch it. Paste the title, company and description with “Import a job manually” and keep this URL as the source link.`);
  try {
    const result = await new GenericProvider({ urls: [url.toString()], allowedHosts: [url.hostname], rateLimitMs: 0 }).search({ queries: [], locations: [], remotePreferences: [], datePostedWindow: 30, maxJobs: limit });
    if (!result.jobs.length) throw new HttpError(422, result.warnings[0] ?? "No structured job posting (schema.org JobPosting) was found on that page. Paste the description manually instead.");
    return result.jobs.map(job => ({ ...job, source: "generic", scope: undefined, sourceMetadata: { ...job.sourceMetadata, imported: true } }));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ProviderError) throw new HttpError(error.code === "BLOCKED" ? 422 : 502, error.message);
    throw error;
  }
}
