import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import { parisDate as todayParis } from "@/lib/dates";
import { loadSettings } from "@/lib/services/settings";
import type { AIHooks, Usage } from "@/ai";

export type Pricing = { inputPerMillion: number; outputPerMillion: number };
const costOf = (inputTokens: number, outputTokens: number, pricing: Pricing) => inputTokens * pricing.inputPerMillion / 1_000_000 + outputTokens * pricing.outputPerMillion / 1_000_000;
function envPricing(): Pricing { const env = config(); if (!env.AI_INPUT_PRICE_PER_MILLION || !env.AI_OUTPUT_PRICE_PER_MILLION) throw new Error("Exact AI token prices are required before paid calls."); return { inputPerMillion: env.AI_INPUT_PRICE_PER_MILLION, outputPerMillion: env.AI_OUTPUT_PRICE_PER_MILLION }; }

/**
 * Reserves one model call's worst-case cost against today's request and cost limits, atomically across processes.
 * Calls still in flight count at their reservation, finished calls at their actual cost, and calls that failed without
 * being billed do not count.
 */
export async function reserveAiCall(call: { provider: string; model: string; operation: string; inputTokens: number; maxOutputTokens: number; pricing: Pricing }) {
  const limits = (await loadSettings()).ai; const reservationId = randomUUID(); const reserved = costOf(call.inputTokens, call.maxOutputTokens, call.pricing);
  await db.$transaction(async transaction => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(74291001)`;
    const calendarDate = todayParis();
    const inFlight = await transaction.aIUsage.aggregate({ where: { calendarDate, status: "RESERVED" }, _sum: { reservedCost: true }, _count: true });
    const finished = await transaction.aIUsage.aggregate({ where: { calendarDate, status: "COMPLETED" }, _sum: { estimatedCost: true }, _count: true });
    if (inFlight._count + finished._count >= limits.maxAnalysesPerDay) throw new Error("Daily AI request limit reached.");
    const spent = Number(inFlight._sum.reservedCost ?? 0) + Number(finished._sum.estimatedCost ?? 0);
    if (spent + reserved > limits.maxCostPerDay) throw new Error("Daily AI cost limit reached.");
    await transaction.aIUsage.create({ data: { calendarDate, provider: call.provider, model: call.model, operation: call.operation, status: "RESERVED", reservationId, reservedCost: new Prisma.Decimal(reserved), estimatedCost: new Prisma.Decimal(reserved) } });
  });
  return reservationId;
}
export async function completeAiCall(reservationId: string, usage: { inputTokens: number; outputTokens: number; costUsd: number }) {
  await db.aIUsage.update({ where: { reservationId }, data: { status: "COMPLETED", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedCost: new Prisma.Decimal(usage.costUsd) } });
}
/** A call that produced no usable answer. One that may have been billed (timeout, dropped connection) stays reserved. */
export async function releaseAiCall(reservationId: string, billed: boolean) {
  if (billed) return;
  await db.aIUsage.update({ where: { reservationId }, data: { status: "FAILED", estimatedCost: new Prisma.Decimal(0) } });
}

export const usageHooks: AIHooks = {
  async beforeRequest(inputChars, maxOutputTokens, model, operation) { return reserveAiCall({ provider: config().AI_PROVIDER, model, operation, inputTokens: Math.ceil(inputChars / 3), maxOutputTokens, pricing: envPricing() }); },
  async afterRequest(reservationId: string, usage: Usage) { await completeAiCall(reservationId, { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costUsd: costOf(usage.inputTokens, usage.outputTokens, envPricing()) }); }
};
