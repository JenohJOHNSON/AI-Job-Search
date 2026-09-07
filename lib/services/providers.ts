import { db } from "@/lib/db";
import { providerCatalog } from "@/providers";

export async function ensureProviders() {
  await Promise.all(providerCatalog.map(provider => db.providerSetting.upsert({
    where: { id: provider.id },
    create: { id: provider.id, name: provider.name, supported: provider.supported, enabled: false, strategies: provider.method === "OFFICIAL_API" || provider.method === "PUBLIC_ENDPOINT" ? [provider.method] : provider.method === "STATIC_HTML" ? ["SCHEMA_ORG_JSON_LD"] : [], config: {}, health: { create: { status: "DISABLED", message: provider.description } } },
    update: { name: provider.name, supported: provider.supported }
  })));
}

export async function providerView() {
  await ensureProviders(); const providers = await db.providerSetting.findMany({ include: { health: true }, orderBy: { name: "asc" } });
  return providers.map(provider => ({ ...provider, strategies: provider.strategies, config: provider.config, status: !provider.enabled ? "DISABLED" : provider.health?.status ?? "DEGRADED", message: provider.health?.message ?? null, lastSuccessAt: provider.health?.lastSuccessAt ?? null, jobsDiscovered: provider.health?.jobsDiscovered ?? 0, errorRate: provider.health?.attemptCount ? provider.health.errorCount / provider.health.attemptCount : 0, health: undefined }));
}
