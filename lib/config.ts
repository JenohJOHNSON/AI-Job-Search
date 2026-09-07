import { z } from "zod";

const optionalUrl = z.string().url().optional().or(z.literal(""));
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(32),
  SETUP_SECRET: z.string().min(16),
  JOB_RUNNER_SECRET: z.string().min(24),
  AI_PROVIDER: z.enum(["openai", "anthropic", "gemini", "openrouter"]).default("openai"),
  AI_MODEL: z.string().default(""),
  AI_FALLBACK_MODEL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  OPENROUTER_API_KEY: z.string().default(""),
  AI_INPUT_PRICE_PER_MILLION: z.coerce.number().positive().optional(),
  AI_OUTPUT_PRICE_PER_MILLION: z.coerce.number().positive().optional(),
  FRANCE_TRAVAIL_CLIENT_ID: z.string().default(""),
  FRANCE_TRAVAIL_CLIENT_SECRET: z.string().default(""),
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
