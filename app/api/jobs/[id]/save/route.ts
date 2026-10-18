import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
type Context = { params: Promise<{ id: string }> };
// Saving never downgrades progress: an application that is already applied, interviewing, etc. keeps its status.
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); const user = await requireUser(), { id } = await context.params;
    if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found.");
    const existing = await db.application.findUnique({ where: { jobId: id } });
    if (existing && !["NEW", "REVIEWED"].includes(existing.status)) return NextResponse.json(existing);
    const application = existing
      ? await db.application.update({ where: { id: existing.id }, data: { status: "SAVED", history: { create: { fromStatus: existing.status, toStatus: "SAVED" } } }, include: { history: true } })
      : await db.application.create({ data: { jobId: id, userId: user.id, status: "SAVED", history: { create: { toStatus: "SAVED" } } }, include: { history: true } });
    await db.job.update({ where: { id }, data: { dismissedAt: null } });
    return NextResponse.json(application);
  } catch (error) { return routeError(error); }
}
