import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { aiConfigured, scoringConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { enqueueTask } from "@/lib/services/queue";
import { scoringInProgress } from "@/lib/services/scoring";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); await requireUser(); const { id } = await context.params;
    if (!scoringConfigured() && !aiConfigured()) throw new HttpError(409, "AI scoring is not configured (set OPENROUTER_API_KEY for multi-model scoring). Rule-based match scores are shown without it.");
    if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found.");
    if (scoringConfigured() && await scoringInProgress(id)) throw new HttpError(409, "This job is already being scored. The results appear on this page as each model answers.");
    const task = await enqueueTask("ANALYZE_JOB", { id }, `analyze:${id}:${Date.now()}`);
    return NextResponse.json({ queued: true, taskId: task.id }, { status: 202 });
  } catch (error) { return routeError(error); }
}
