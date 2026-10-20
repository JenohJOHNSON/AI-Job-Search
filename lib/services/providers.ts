import { config } from "@/lib/config";
import { db } from "@/lib/db";
import { createProvider, providerCatalog, type ProviderConfig } from "@/providers";

export async function ensureProviders() {
  await Promise.all(providerCatalog.map(provider => db.providerSetting.upsert({
    where: { id: provider.id },
    create: { id: provider.id, name: provider.name, supported: provider.supported, enabled: false, strategies: provider.method === "OFFICIAL_API" || provider.method === "PUBLIC_ENDPOINT" ? [provider.method] : provider.method === "STATIC_HTML" ? ["SCHEMA_ORG_JSON_LD"] : [], config: {}, health: { create: { status: "DISABLED", message: provider.description } } },
    update: { name: provider.name, supported: provider.supported }
  })));
}

export async function providerView() {
  await ensureProviders(); const env = config();
  const providers = await db.providerSetting.findMany({ include: { health: true }, orderBy: { name: "asc" } });
  return providers.map(provider => {
    const catalog = providerCatalog.find(item => item.id === provider.id);
    const credentialsConfigured = provider.id === "france_travail" ? Boolean(env.FRANCE_TRAVAIL_CLIENT_ID && env.FRANCE_TRAVAIL_CLIENT_SECRET) : provider.id === "email_alerts" ? Boolean(env.IMAP_URL) : catalog?.method === "APIFY" ? Boolean(env.APIFY_API_TOKEN) : true;
    return { ...provider, strategies: provider.strategies, config: provider.config, method: catalog?.method ?? "UNSUPPORTED", description: catalog?.description ?? "", costPerJobUsd: catalog?.costPerJobUsd, credentialsConfigured, status: !provider.enabled ? "DISABLED" : provider.health?.status ?? "DEGRADED", message: provider.health?.message ?? null, lastSuccessAt: provider.health?.lastSuccessAt ?? null, jobsDiscovered: provider.health?.jobsDiscovered ?? 0, errorRate: provider.health?.attemptCount ? provider.health.errorCount / provider.health.attemptCount : 0, health: undefined };
  });
}

function asConfig(value: unknown, rateLimitMs: number): ProviderConfig {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (item: unknown) => Array.isArray(item) ? item.filter((entry): entry is string => typeof entry === "string") : [];
  return { boards: strings(object.boards), urls: strings(object.urls), allowedHosts: strings(object.allowedHosts), rateLimitMs };
}

/** Runs the adapter's own connectivity check with the saved configuration and records the outcome in provider health. */
export async function checkProvider(id: string) {
  const setting = await db.providerSetting.findUniqueOrThrow({ where: { id } });
  if (!setting.supported) return { status: "DISABLED" as const, detail: "No permitted integration exists for this platform." };
  const result = await createProvider(id, asConfig(setting.config, setting.rateLimitMs)).healthCheck();
  const status = setting.enabled || result.status === "FAILED" ? result.status : "DISABLED";
  await db.providerHealth.upsert({ where: { providerId: id }, create: { providerId: id, status, message: result.detail.slice(0, 2_000) }, update: { status, message: result.detail.slice(0, 2_000), ...(result.status === "HEALTHY" ? { lastSuccessAt: new Date() } : {}) } });
  return result;
}
