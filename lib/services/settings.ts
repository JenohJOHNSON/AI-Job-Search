import { z } from "zod";
import { config } from "@/lib/config";
import { db } from "@/lib/db";

// Owner-editable settings live in SystemSetting rows. Environment variables stay the hard ceilings
// (an operator decides the maximum spend; the owner may only lower it).
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const timezone = z.string().max(64).refine(value => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Unknown time zone.");

export const settingsPatchSchema = z.object({
  notifications: z.object({ emailEnabled: z.boolean(), telegramEnabled: z.boolean(), minScore: z.coerce.number().int().min(0).max(100), maxPerDigest: z.coerce.number().int().min(1).max(25) }).partial().strict().optional(),
  schedule: z.object({ enabled: z.boolean(), time, timezone }).partial().strict().optional(),
  ai: z.object({ maxAnalysesPerDay: z.coerce.number().int().min(0).max(1000), maxCostPerDay: z.coerce.number().min(0).max(1000), matchThreshold: z.coerce.number().int().min(0).max(100) }).partial().strict().optional(),
  limits: z.object({ maxJobsPerProvider: z.coerce.number().int().min(1).max(500), maxTotalJobsPerRun: z.coerce.number().int().min(1).max(5000) }).partial().strict().optional()
}).strict();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export type RuntimeSettings = {
  notifications: { emailEnabled: boolean; telegramEnabled: boolean; minScore: number; maxPerDigest: number };
  schedule: { enabled: boolean; time: string; timezone: string };
  ai: { maxAnalysesPerDay: number; maxCostPerDay: number; matchThreshold: number };
  limits: { maxJobsPerProvider: number; maxTotalJobsPerRun: number };
};

const keys = {
  "notifications.email": ["notifications", "emailEnabled"], "notifications.telegram": ["notifications", "telegramEnabled"], "notifications.minScore": ["notifications", "minScore"], "notifications.maxPerDigest": ["notifications", "maxPerDigest"],
  "schedule.enabled": ["schedule", "enabled"], "schedule.time": ["schedule", "time"], "schedule.timezone": ["schedule", "timezone"],
  "ai.maxAnalysesPerDay": ["ai", "maxAnalysesPerDay"], "ai.maxCostPerDay": ["ai", "maxCostPerDay"], "ai.matchThreshold": ["ai", "matchThreshold"],
  "limits.maxJobsPerProvider": ["limits", "maxJobsPerProvider"], "limits.maxTotalJobsPerRun": ["limits", "maxTotalJobsPerRun"]
} as const;

export function defaults(): RuntimeSettings {
  const env = config();
  return {
    notifications: { emailEnabled: false, telegramEnabled: false, minScore: env.NOTIFICATION_SCORE_THRESHOLD, maxPerDigest: 12 },
    schedule: { enabled: true, time: "06:30", timezone: "Europe/Paris" },
    ai: { maxAnalysesPerDay: env.MAX_AI_ANALYSES_PER_DAY, maxCostPerDay: env.MAX_LLM_COST_PER_DAY, matchThreshold: env.AI_MATCH_THRESHOLD },
    limits: { maxJobsPerProvider: env.MAX_JOBS_PER_PROVIDER, maxTotalJobsPerRun: env.MAX_TOTAL_JOBS_PER_RUN }
  };
}

export async function loadSettings(): Promise<RuntimeSettings> {
  const env = config(); const settings = defaults();
  const rows = await db.systemSetting.findMany({ where: { key: { in: Object.keys(keys) } } });
  for (const row of rows) { const path = keys[row.key as keyof typeof keys]; if (path) (settings[path[0]] as Record<string, unknown>)[path[1]] = row.value; }
  // Stored values can never exceed the operator's environment ceilings.
  settings.ai.maxAnalysesPerDay = Math.min(settings.ai.maxAnalysesPerDay, env.MAX_AI_ANALYSES_PER_DAY);
  settings.ai.maxCostPerDay = Math.min(settings.ai.maxCostPerDay, env.MAX_LLM_COST_PER_DAY);
  settings.limits.maxJobsPerProvider = Math.min(settings.limits.maxJobsPerProvider, env.MAX_JOBS_PER_PROVIDER);
  settings.limits.maxTotalJobsPerRun = Math.min(settings.limits.maxTotalJobsPerRun, env.MAX_TOTAL_JOBS_PER_RUN);
  return settings;
}

export async function saveSettings(patch: SettingsPatch) {
  const writes = (Object.entries(keys) as [keyof typeof keys, readonly [keyof SettingsPatch, string]][]).flatMap(([key, [group, field]]) => {
    const value = (patch[group] as Record<string, unknown> | undefined)?.[field]; return value === undefined ? [] : [db.systemSetting.upsert({ where: { key }, create: { key, value: value as never }, update: { value: value as never } })];
  });
  if (writes.length) await db.$transaction(writes);
  return loadSettings();
}
