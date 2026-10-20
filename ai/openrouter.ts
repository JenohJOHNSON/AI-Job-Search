import { config } from "@/lib/config";

/** What OpenRouter publishes about a model: whether it exists, its limits, the parameters it accepts and its current price. */
export type CatalogModel = { id: string; contextLength: number; maxCompletionTokens: number | null; inputPerMillion: number; outputPerMillion: number; parameters: Set<string> };
export type ModelCatalog = Map<string, CatalogModel>;

const CATALOG_TTL_MS = 6 * 3_600_000;
const endpoint = (path: string) => `${config().OPENROUTER_BASE_URL.replace(/\/+$/, "")}${path}`;
let cached: { at: number; catalog: ModelCatalog } | null = null;
export function resetCatalogCache() { cached = null; }

type RawModel = { id?: unknown; context_length?: unknown; pricing?: { prompt?: unknown; completion?: unknown }; top_provider?: { max_completion_tokens?: unknown }; supported_parameters?: unknown };
const perMillion = (value: unknown) => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : NaN; };

/** OpenRouter's public model list, cached for six hours. Null when it cannot be read and nothing is cached. */
export async function modelCatalog(now = Date.now()): Promise<ModelCatalog | null> {
  if (cached && now - cached.at < CATALOG_TTL_MS) return cached.catalog;
  try {
    const response = await fetch(endpoint("/models"), { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return cached?.catalog ?? null;
    const body = await response.json() as { data?: RawModel[] };
    const catalog: ModelCatalog = new Map();
    for (const raw of body.data ?? []) {
      if (typeof raw.id !== "string") continue;
      const inputPerMillion = perMillion(raw.pricing?.prompt), outputPerMillion = perMillion(raw.pricing?.completion);
      if (!Number.isFinite(inputPerMillion) || !Number.isFinite(outputPerMillion)) continue;
      const maxCompletion = Number(raw.top_provider?.max_completion_tokens);
      catalog.set(raw.id, { id: raw.id, contextLength: Number(raw.context_length) || 0, maxCompletionTokens: Number.isFinite(maxCompletion) && maxCompletion > 0 ? maxCompletion : null, inputPerMillion, outputPerMillion, parameters: new Set(Array.isArray(raw.supported_parameters) ? raw.supported_parameters.filter((item): item is string => typeof item === "string") : []) });
    }
    if (!catalog.size) return cached?.catalog ?? null;
    cached = { at: now, catalog }; return catalog;
  } catch { return cached?.catalog ?? null; }
}

/**
 * Why a call failed. Retrying only helps for RATE_LIMIT, TIMEOUT, PROVIDER and NETWORK; the others move straight to the next
 * model, except AUTH and BUDGET, which stop scoring altogether because no other model can succeed.
 */
export type ChatErrorCode = "CONTEXT_LIMIT" | "OUTPUT_LIMIT" | "RATE_LIMIT" | "QUOTA" | "AUTH" | "UNAVAILABLE" | "MODERATION" | "BAD_REQUEST" | "TIMEOUT" | "PROVIDER" | "NETWORK" | "INVALID_RESPONSE" | "BUDGET";
export class ChatError extends Error {
  /** `billed` is true when OpenRouter may have charged the call (it answered, or the outcome is unknown). */
  constructor(public code: ChatErrorCode, message: string, public billed = false, public retryAfterMs?: number) { super(message); }
}
export const retryable = (code: ChatErrorCode) => code === "RATE_LIMIT" || code === "TIMEOUT" || code === "PROVIDER" || code === "NETWORK";

export type ChatMessage = { role: "system" | "user"; content: string };
export type ChatRequest = { model: string; messages: ChatMessage[]; maxTokens: number; jsonSchema?: { name: string; schema: Record<string, unknown> }; reasoningEffort?: string; seed?: number };
export type ChatResult = { content: string; model: string; inputTokens: number; outputTokens: number; costUsd: number | null; finishReason: string | null };

function classify(status: number, message: string): ChatError {
  const text = message.slice(0, 300);
  if (status === 401) return new ChatError("AUTH", `OpenRouter rejected the API key: ${text}`);
  if (status === 402) return new ChatError("QUOTA", `OpenRouter credits or key limit exhausted: ${text}`);
  if (status === 403) return new ChatError("MODERATION", `The request was refused: ${text}`);
  if (status === 404) return new ChatError("UNAVAILABLE", `Model unavailable: ${text}`);
  if (status === 408) return new ChatError("TIMEOUT", `The model timed out: ${text}`);
  if (status === 413 || ((status === 400 || status === 422) && /context|too long|too many tokens|maximum.{0,30}tokens|token limit|prompt is too long/i.test(text))) return new ChatError("CONTEXT_LIMIT", `Context window exceeded: ${text}`);
  if (status === 429) return new ChatError("RATE_LIMIT", `Rate limited: ${text}`);
  if (status === 503) return new ChatError("UNAVAILABLE", `No provider can serve the model right now: ${text}`);
  if (status >= 500) return new ChatError("PROVIDER", `The model's provider failed (HTTP ${status}): ${text}`);
  return new ChatError("BAD_REQUEST", `HTTP ${status}: ${text}`);
}
const contentText = (content: unknown) => typeof content === "string" ? content : Array.isArray(content) ? content.map(part => typeof part === "string" ? part : (part as { text?: unknown })?.text).filter((part): part is string => typeof part === "string").join("") : "";

/** One chat completion through OpenRouter. Never retries by itself: the caller decides, per error code. */
export async function openRouterChat(request: ChatRequest, timeoutMs = 60_000): Promise<ChatResult> {
  const env = config(); if (!env.OPENROUTER_API_KEY) throw new ChatError("AUTH", "OPENROUTER_API_KEY is not set.");
  const body = {
    model: request.model, messages: request.messages, max_tokens: request.maxTokens, usage: { include: true },
    ...(request.jsonSchema ? { response_format: { type: "json_schema", json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema } } } : {}),
    ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort, exclude: true } } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {})
  };
  let response: Response;
  try {
    response = await fetch(endpoint("/chat/completions"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "HTTP-Referer": env.APP_URL, "X-Title": "Elan Job Search" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const name = (error as Error).name;
    // Whether a timed-out or dropped call was billed is unknown, so it is treated as billed.
    if (name === "TimeoutError" || name === "AbortError") throw new ChatError("TIMEOUT", `No answer within ${Math.round(timeoutMs / 1000)} s.`, true);
    throw new ChatError("NETWORK", `Could not reach OpenRouter: ${(error as Error).message}`, true);
  }
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(text) as Record<string, unknown>; } catch { if (response.ok) throw new ChatError("INVALID_RESPONSE", "OpenRouter returned a body that is not JSON.", true); }
  const failure = data.error as { code?: unknown; message?: unknown } | undefined;
  if (!response.ok) {
    const error = classify(response.status, typeof failure?.message === "string" ? failure.message : text);
    const retryAfter = Number(response.headers.get("retry-after")); if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
    throw error;
  }
  // OpenRouter can report a provider failure inside a 200 response.
  if (failure) { const error = classify(Number(failure.code) || 502, typeof failure.message === "string" ? failure.message : "provider error"); error.billed = true; throw error; }
  const choice = (data.choices as { message?: { content?: unknown }; finish_reason?: unknown; native_finish_reason?: unknown }[] | undefined)?.[0];
  const usage = data.usage as { prompt_tokens?: unknown; completion_tokens?: unknown; cost?: unknown } | undefined;
  const result: ChatResult = { content: contentText(choice?.message?.content), model: typeof data.model === "string" ? data.model : request.model, inputTokens: Number(usage?.prompt_tokens) || 0, outputTokens: Number(usage?.completion_tokens) || 0, costUsd: Number.isFinite(Number(usage?.cost)) && usage?.cost !== undefined && usage?.cost !== null ? Number(usage.cost) : null, finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null };
  if (result.finishReason === "error") throw new ChatError("PROVIDER", "The model's provider stopped with an error.", true);
  return result;
}
