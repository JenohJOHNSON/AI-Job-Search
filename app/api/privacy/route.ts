import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
export async function DELETE(request: NextRequest) { try { assertSameOrigin(request); const user = await requireUser(); await parseBody(request, z.object({ confirmation: z.literal("DELETE MY DATA") }).strict()); await db.user.delete({ where: { id: user.id } }); return NextResponse.json({ deleted: true }); } catch (error) { return routeError(error); } }
