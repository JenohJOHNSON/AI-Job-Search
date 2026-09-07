import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { providerPatchSchema } from "@/lib/schemas";
type Context = { params: Promise<{ id: string }> };
export async function PATCH(request: NextRequest, context: Context) { try { assertSameOrigin(request); await requireUser(); const { id } = await context.params; const input = await parseBody(request, providerPatchSchema); const provider = await db.providerSetting.findUnique({ where: { id } }); if (!provider) throw new HttpError(404, "Provider not found."); if (input.enabled && !provider.supported) throw new HttpError(400, "This provider has no permitted supported integration."); const updated = await db.providerSetting.update({ where: { id }, data: input }); if (input.enabled !== undefined) await db.providerHealth.updateMany({ where: { providerId: id }, data: { status: input.enabled ? "DEGRADED" : "DISABLED", message: input.enabled ? "Enabled; health will be checked by the next run." : "Disabled by user." } }); return NextResponse.json(updated); } catch (error) { return routeError(error); } }
