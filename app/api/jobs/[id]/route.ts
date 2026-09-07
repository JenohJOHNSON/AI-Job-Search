import { NextResponse } from "next/server";
import { HttpError, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { jobInclude, serializeJob } from "@/lib/services/jobs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { try { await requireUser(); const { id } = await context.params; const job = await db.job.findUnique({ where: { id }, include: jobInclude }); if (!job) throw new HttpError(404, "Job not found."); return NextResponse.json(serializeJob(job)); } catch (error) { return routeError(error); } }
