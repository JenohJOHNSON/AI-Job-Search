import { NextResponse } from "next/server";
import { requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { jobInclude, serializeJob } from "@/lib/services/jobs";
export async function GET() { try { const user = await requireUser(); const applications = await db.application.findMany({ where: { userId: user.id }, include: { history: { orderBy: { createdAt: "desc" } }, job: { include: jobInclude } }, orderBy: { updatedAt: "desc" } }); return NextResponse.json({ applications: applications.map(application => ({ ...application, job: serializeJob(application.job) })) }); } catch (error) { return routeError(error); } }
