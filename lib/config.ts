import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Deprecated and unused: sessions are random server-side tokens stored hashed. Still validated when present so old deployments keep starting.
  NEXTAUTH_SECRET: z.string().min(32).optional(),
  SETUP_SECRET: z.string().min(16),
  JOB_RUNNER_SECRET: z.string().min(24),
  AI_PROVIDER: z.enum(["openai", "anthropic", "gemini", "openrouter"]).default("openai"),
  AI_MODEL: z.string().default(""),
  AI_FALLBACK_MODEL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  // OpenRouter's API root. Only changed for an OpenRouter-compatible gateway or the local fake used by the browser test.
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  AI_INPUT_PRICE_PER_MILLION: z.coerce.number().positive().optional(),
  AI_OUTPUT_PRICE_PER_MILLION: z.coerce.number().positive().optional(),
  // Multi-model job scoring through OpenRouter: one slot per independent evaluation, each "primary,fallback,fallback".
  // An empty value disables that slot. IDs are OpenRouter model IDs (https://openrouter.ai/models); prices come from OpenRouter.
  AI_SCORING_SLOT_1: z.string().default("anthropic/claude-sonnet-5.5,anthropic/claude-sonnet-5,openai/gpt-6.1-sol"),
  AI_SCORING_SLOT_2: z.string().default("anthropic/claude-fable-5.1,anthropic/claude-fable-5,anthropic/claude-opus-5.5"),
  AI_SCORING_SLOT_3: z.string().default("openai/gpt-6-astra,openai/gpt-6-luna,openai/gpt-6-sol"),
  // "default" sends no reasoning setting and leaves each model at its own default.
  AI_SCORING_REASONING_EFFORT: z.enum(["default", "minimal", "low", "medium", "high"]).default("low"),
  FRANCE_TRAVAIL_CLIENT_ID: z.string().default(""),
  FRANCE_TRAVAIL_CLIENT_SECRET: z.string().default(""),
  // Opt-in third-party scraping of job portals (LinkedIn, Indeed, HelloWork, Welcome to the Jungle); runs are billed to this Apify account.
  APIFY_API_TOKEN: z.string().default(""),
  // Read-only mailbox holding the portals' job-alert emails, e.g. imaps://user%40gmail.com:app-password@imap.gmail.com:993/INBOX
  // Checked only when the job-alert source runs, so a typo disables that source instead of stopping the whole app.
  IMAP_URL: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  SMTP_URL: optionalUrl,
  EMAIL_FROM: z.string().default(""),
  DIGEST_TO: z.string().email().optional().or(z.literal("")),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_CHAT_ID: z.string().default(""),
  MAX_AI_ANALYSES_PER_DAY: z.coerce.number().int().min(0).max(1000).default(30),
  MAX_LLM_COST_PER_DAY: z.coerce.number().min(0).max(1000).default(2),
  MAX_JOBS_PER_PROVIDER: z.coerce.number().int().min(1).max(500).default(50),
  MAX_TOTAL_JOBS_PER_RUN: z.coerce.number().int().min(1).max(5000).default(200),
  AI_MATCH_THRESHOLD: z.coerce.number().int().min(0).max(100).default(40),
  NOTIFICATION_SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(80),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  TASK_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(300)
});

let memo: z.infer<typeof envSchema> | undefined;
export function config() {
  if (!memo) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      const missing = parsed.error.issues.map(issue => issue.path.join(".")).join(", ");
      throw new Error(`Invalid environment configuration. Set these Railway variables before starting the service: ${missing}`);
    }
    memo = parsed.data;
  }
  return memo;
}

export function aiConfigured() {
  const env = config();
  const key = { openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY, gemini: env.GEMINI_API_KEY, openrouter: env.OPENROUTER_API_KEY }[env.AI_PROVIDER];
  return Boolean(env.AI_MODEL && key && env.AI_INPUT_PRICE_PER_MILLION && env.AI_OUTPUT_PRICE_PER_MILLION);
}

const modelId = /^~?[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;
export type ScoringSlot = { slot: number; models: string[] };
/** The configured scoring slots, in priority order. Malformed IDs are reported, never sent. */
export function scoringSlots(): { slots: ScoringSlot[]; invalid: string[] } {
  const env = config(); const invalid: string[] = [];
  const slots = [env.AI_SCORING_SLOT_1, env.AI_SCORING_SLOT_2, env.AI_SCORING_SLOT_3].map((value, index) => {
    const models = [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))].filter(item => modelId.test(item) || (invalid.push(item), false));
    return { slot: index + 1, models: models.slice(0, 4) };
  }).filter(slot => slot.models.length > 0);
  return { slots, invalid };
}
/** Multi-model scoring needs only an OpenRouter key: per-model prices are read from OpenRouter's catalog. */
export function scoringConfigured() { return Boolean(config().OPENROUTER_API_KEY) && scoringSlots().slots.length > 0; }
