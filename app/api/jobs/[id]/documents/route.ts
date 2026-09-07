import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { enqueueTask } from "@/lib/services/queue";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { try { const user = await requireUser(), { id } = await context.params; const documents = await db.generatedDocument.findMany({ where: { userId: user.id, jobId: id }, orderBy: { createdAt: "desc" } }); return NextResponse.json({ documents }); } catch (error) { return routeError(error); } }
export async function POST(request: NextRequest, context: Context) { try { assertSameOrigin(request); const user = await requireUser(), { id } = await context.params; const input = await parseBody(request, z.object({ kind: z.enum(["cv", "cover-letter"]), language: z.enum(["fr", "en"]) }).strict()); if (!(await db.job.count({ where: { id } }))) throw new HttpError(404, "Job not found."); const task = await enqueueTask("GENERATE_DOCUMENT", { id, userId: user.id, ...input }, `document:${id}:${input.kind}:${input.language}:${Date.now()}`); return NextResponse.json({ queued: true, taskId: task.id }, { status: 202 }); } catch (error) { return routeError(error); } }
