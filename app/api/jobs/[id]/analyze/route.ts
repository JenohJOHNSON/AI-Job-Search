import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { aiConfigured } from "@/lib/config";
import { db } from "@/lib/db";
import { enqueueTask } from "@/lib/services/queue";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); await requireUser(); const { id } = await context.params;
    if (!aiConfigured()) throw new HttpError(409, "AI analysis is not configured (set AI_MODEL, the provider key and both token prices). Rule-based match scores are shown without it.");
    if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found.");
    const task = await enqueueTask("ANALYZE_JOB", { id }, `analyze:${id}:${Date.now()}`);
    return NextResponse.json({ queued: true, taskId: task.id }, { status: 202 });
  } catch (error) { return routeError(error); }
}
