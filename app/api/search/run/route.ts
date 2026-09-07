import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, requireUser, routeError } from "@/lib/api";
import { createSearchRun } from "@/lib/services/search";
export async function POST(request: NextRequest) { try { assertSameOrigin(request); await requireUser(); const run = await createSearchRun("MANUAL"); return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 }); } catch (error) { return routeError(error); } }
