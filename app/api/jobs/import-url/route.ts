import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { rateLimit } from "@/lib/security/rate-limit";
import { importFromUrl } from "@/lib/services/import";
import { ingestJob, saveMatch } from "@/lib/services/jobs";
import { loadMatchingContext } from "@/lib/services/matching";
import { scoreJob } from "@/matching/score";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); const user = await requireUser(); const { url } = await parseBody(request, z.object({ url: z.string().trim().max(2_000) }).strict());
    if (!rateLimit(`import-url:${user.id}`, 15, 10 * 60_000)) throw new HttpError(429, "Too many imports. Try again in a few minutes.");
    const jobs = await importFromUrl(url); const context = await loadMatchingContext(); const imported: { id: string; title: string; duplicate: boolean }[] = [];
    for (const job of jobs) {
      const saved = await ingestJob(job); if (context) await saveMatch(saved.job.id, scoreJob(context.candidate, job, context.profiles), context.profileVersion);
      imported.push({ id: saved.job.id, title: job.title, duplicate: saved.duplicate });
    }
    return NextResponse.json({ imported }, { status: 201 });
  } catch (error) { return routeError(error); }
}
