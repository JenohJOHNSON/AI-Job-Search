import { NextResponse } from "next/server";
import { requireUser, routeError } from "@/lib/api";
import { providerView } from "@/lib/services/providers";
export async function GET() { try { await requireUser(); return NextResponse.json({ providers: await providerView() }); } catch (error) { return routeError(error); } }
