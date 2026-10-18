import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); await requireUser(); const { id } = await context.params;
    const { dismissed } = await parseBody(request, z.object({ dismissed: z.boolean().default(true) }).strict());
    if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found.");
    const job = await db.job.update({ where: { id }, data: { dismissedAt: dismissed ? new Date() : null }, select: { id: true, dismissedAt: true } });
    return NextResponse.json(job);
  } catch (error) { return routeError(error); }
}
