import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, HttpError, parseBody, requireUser, routeError } from "@/lib/api";
import { db } from "@/lib/db";
import { providerPatchSchema } from "@/lib/schemas";
type Context = { params: Promise<{ id: string }> };
const unique = (values?: string[]) => values && [...new Map(values.map(value => [value.toLowerCase(), value])).values()];
export async function PATCH(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request); await requireUser(); const { id } = await context.params; const input = await parseBody(request, providerPatchSchema);
    const provider = await db.providerSetting.findUnique({ where: { id } }); if (!provider) throw new HttpError(404, "Provider not found.");
    if (input.enabled && !provider.supported) throw new HttpError(400, "This provider has no permitted supported integration.");
    const previous = provider.config && typeof provider.config === "object" && !Array.isArray(provider.config) ? provider.config as Record<string, unknown> : {};
    // Partial config updates merge with what is stored so editing boards never wipes career-page settings.
    const config = input.config ? { ...previous, ...(input.config.boards ? { boards: unique(input.config.boards) } : {}), ...(input.config.urls ? { urls: unique(input.config.urls) } : {}), ...(input.config.allowedHosts ? { allowedHosts: unique(input.config.allowedHosts) } : {}) } : undefined;
    const updated = await db.providerSetting.update({ where: { id }, data: { ...(input.enabled !== undefined ? { enabled: input.enabled } : {}), ...(input.maxJobs ? { maxJobs: input.maxJobs } : {}), ...(input.rateLimitMs ? { rateLimitMs: input.rateLimitMs } : {}), ...(input.strategies ? { strategies: input.strategies } : {}), ...(config ? { config } : {}) } });
    if (input.enabled !== undefined) await db.providerHealth.updateMany({ where: { providerId: id }, data: { status: input.enabled ? "DEGRADED" : "DISABLED", message: input.enabled ? "Enabled; run a connectivity check or a search to confirm it works." : "Disabled by user." } });
    return NextResponse.json(updated);
  } catch (error) { return routeError(error); }
}
