import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { searchProfileInputSchema } from "@/lib/schemas";
type Context = { params: Promise<{ id: string }> };
export async function PUT(request: NextRequest, context: Context) { try { assertSameOrigin(request); const user = await requireUser(), { id } = await context.params; const input = await parseBody(request, searchProfileInputSchema); const result = await db.searchProfile.updateMany({ where: { id, userId: user.id }, data: { name: input.name, enabled: input.enabled, data: input } }); if (!result.count) throw new HttpError(404, "Search profile not found."); return NextResponse.json({ id, ...input }); } catch (error) { return routeError(error); } }
export async function DELETE(request: NextRequest, context: Context) { try { assertSameOrigin(request); const user = await requireUser(), { id } = await context.params; const result = await db.searchProfile.deleteMany({ where: { id, userId: user.id } }); if (!result.count) throw new HttpError(404, "Search profile not found."); return NextResponse.json({ ok: true }); } catch (error) { return routeError(error); } }
