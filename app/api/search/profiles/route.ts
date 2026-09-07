import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { searchProfileInputSchema } from "@/lib/schemas";
export async function GET() { try { const user = await requireUser(); const profiles = await db.searchProfile.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }); return NextResponse.json({ profiles: profiles.map(profile => ({ id: profile.id, ...searchProfileInputSchema.parse(profile.data), name: profile.name, enabled: profile.enabled })) }); } catch (error) { return routeError(error); } }
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const user = await requireUser(); const input = await parseBody(request, searchProfileInputSchema); const profile = await db.searchProfile.create({ data: { userId: user.id, name: input.name, enabled: input.enabled, data: input } }); return NextResponse.json({ id: profile.id, ...input }, { status: 201 }); } catch (error) { return routeError(error); } }
