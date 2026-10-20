import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin, parseBody, requireUser, routeError } from "@/lib/api";
import { aiConfigured, config, scoringConfigured, scoringSlots } from "@/lib/config";
import { channelsConfigured } from "@/lib/services/notifications";
import { loadSettings, saveSettings, settingsPatchSchema } from "@/lib/services/settings";

async function view() {
  const env = config(); const settings = await loadSettings(); const channels = channelsConfigured();
  const missing = [!env.AI_MODEL && "AI_MODEL", !({ openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY, gemini: env.GEMINI_API_KEY, openrouter: env.OPENROUTER_API_KEY }[env.AI_PROVIDER]) && `${env.AI_PROVIDER.toUpperCase()}_API_KEY`, !env.AI_INPUT_PRICE_PER_MILLION && "AI_INPUT_PRICE_PER_MILLION", !env.AI_OUTPUT_PRICE_PER_MILLION && "AI_OUTPUT_PRICE_PER_MILLION"].filter(Boolean) as string[];
  return {
    ai: { provider: env.AI_PROVIDER, model: env.AI_MODEL, configured: aiConfigured(), missing, fallbackModel: env.AI_FALLBACK_MODEL },
    // Model IDs only; the OpenRouter key never leaves the server.
    scoring: { configured: scoringConfigured(), keyConfigured: Boolean(env.OPENROUTER_API_KEY), slots: scoringSlots().slots, invalid: scoringSlots().invalid, reasoningEffort: env.AI_SCORING_REASONING_EFFORT },
    limits: { maxAiAnalysesPerDay: settings.ai.maxAnalysesPerDay, maxLlmCostPerDay: settings.ai.maxCostPerDay, aiMatchThreshold: settings.ai.matchThreshold, maxJobsPerProvider: settings.limits.maxJobsPerProvider, maxTotalJobsPerRun: settings.limits.maxTotalJobsPerRun, notificationScoreThreshold: settings.notifications.minScore },
    ceilings: { maxAiAnalysesPerDay: env.MAX_AI_ANALYSES_PER_DAY, maxLlmCostPerDay: env.MAX_LLM_COST_PER_DAY, maxJobsPerProvider: env.MAX_JOBS_PER_PROVIDER, maxTotalJobsPerRun: env.MAX_TOTAL_JOBS_PER_RUN },
    notifications: { emailEnabled: settings.notifications.emailEnabled, telegramEnabled: settings.notifications.telegramEnabled, minScore: settings.notifications.minScore, maxPerDigest: settings.notifications.maxPerDigest, emailAvailable: channels.email, telegramAvailable: channels.telegram },
    schedule: settings.schedule, appUrl: env.APP_URL
  };
}
export async function GET() { try { await requireUser(); return NextResponse.json(await view()); } catch (error) { return routeError(error); } }
export async function PATCH(request: NextRequest) { try { assertSameOrigin(request); await requireUser(); await saveSettings(await parseBody(request, settingsPatchSchema)); return NextResponse.json(await view()); } catch (error) { return routeError(error); } }
