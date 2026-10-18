import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, parseBody, requireUser, routeError } from "@/lib/api";
import { hash } from "@/lib/deduplication";
import { db } from "@/lib/db";
import { manualJobSchema, normalizedJobSchema } from "@/lib/schemas";
import { buildJobFilter, number, orderings } from "@/lib/services/job-filter";
import { ingestJob, jobInclude, saveMatch, serializeJob } from "@/lib/services/jobs";
import { loadMatchingContext } from "@/lib/services/matching";
import { labelFor, scoreJob } from "@/matching/score";

export async function GET(request: NextRequest) {
  try {
    await requireUser(); const query = request.nextUrl.searchParams;
    const page = Math.max(1, Math.floor(number(query.get("page")) ?? 1)); const pageSize = Math.min(100, Math.max(5, Math.floor(number(query.get("pageSize")) ?? 25)));
    const where = buildJobFilter(query); const orderBy = orderings[query.get("sort") ?? "score"] ?? orderings.score!;
    const [jobs, total] = await Promise.all([db.job.findMany({ where, include: jobInclude, orderBy, skip: (page - 1) * pageSize, take: pageSize }), db.job.count({ where })]);
    return NextResponse.json({ jobs: jobs.map(job => ({ ...serializeJob(job), matchLabel: job.rankScore === null ? null : labelFor(job.rankScore) })), total, page, pageSize });
  } catch (error) { return routeError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); await requireUser(); const input = await parseBody(request, manualJobSchema);
    const normalized = normalizedJobSchema.parse({ source: "manual", sourceJobId: hash(input.sourceUrl), sourceUrl: input.sourceUrl, applicationUrl: input.applicationUrl ?? input.sourceUrl, companyName: input.companyName, title: input.title, location: input.location, remoteType: input.remoteType, contractType: input.contractType, salaryMin: input.salaryMin ?? null, salaryMax: input.salaryMax ?? null, descriptionRaw: input.descriptionClean, descriptionClean: input.descriptionClean, extractor: "manual_import" });
    const saved = await ingestJob(normalized); const context = await loadMatchingContext();
    if (context) await saveMatch(saved.job.id, scoreJob(context.candidate, normalized, context.profiles), context.profileVersion);
    const job = await db.job.findUniqueOrThrow({ where: { id: saved.job.id }, include: jobInclude });
    return NextResponse.json(serializeJob(job), { status: saved.duplicate ? 200 : 201 });
  } catch (error) { return routeError(error); }
}
