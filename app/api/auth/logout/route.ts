import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, routeError } from "@/lib/api";
import { destroySession } from "@/lib/security/session";
export async function POST(request: NextRequest) { try { assertSameOrigin(request); await destroySession(); return NextResponse.json({ ok: true }); } catch (error) { return routeError(error); } }
