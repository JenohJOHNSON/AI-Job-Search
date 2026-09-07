import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { HttpError, routeError } from "@/lib/api";
import { config } from "@/lib/config";
import { createSearchRun } from "@/lib/services/search";
function equal(left: string, right: string) { const a = createHash("sha256").update(left).digest(), b = createHash("sha256").update(right).digest(); return timingSafeEqual(a, b); }
export async function POST(request: NextRequest) { try { const authorization = request.headers.get("authorization") ?? ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""; if (!token || !equal(token, config().JOB_RUNNER_SECRET)) throw new HttpError(401, "Invalid runner credentials."); const idempotencyKey = request.headers.get("idempotency-key")?.slice(0, 200) || undefined; const run = await createSearchRun("GITHUB_ACTION", idempotencyKey); return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 }); } catch (error) { return routeError(error); } }
