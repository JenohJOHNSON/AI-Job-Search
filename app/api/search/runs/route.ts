import { NextResponse } from "next/server";
import { requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
export async function GET() { try { await requireUser(); const runs = await db.searchRun.findMany({ include: { providerRuns: { include: { provider: { select: { name: true } } }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 100 }); return NextResponse.json({ runs: runs.map(run => ({ ...run, providerRuns: run.providerRuns.map(providerRun => ({ ...providerRun, provider: providerRun.provider.name })) })) }); } catch (error) { return routeError(error); } }
