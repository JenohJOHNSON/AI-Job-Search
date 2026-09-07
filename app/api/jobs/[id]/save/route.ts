import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
type Context = { params: Promise<{ id: string }> };
export async function POST(request: NextRequest, context: Context) { try { assertSameOrigin(request); const user = await requireUser(), { id } = await context.params; if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found."); const application = await db.application.upsert({ where: { jobId: id }, create: { jobId: id, userId: user.id, status: "SAVED", history: { create: { toStatus: "SAVED" } } }, update: { status: "SAVED", history: { create: { toStatus: "SAVED" } } }, include: { history: true } }); return NextResponse.json(application); } catch (error) { return routeError(error); } }
