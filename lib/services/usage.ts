import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { config } from "@/lib/config";
import type { AIHooks, Usage } from "@/ai";

function todayParis() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); return new Date(`${parts}T00:00:00.000Z`); }
function estimatedCost(inputTokens: number, outputTokens: number) { const env = config(); if (!env.AI_INPUT_PRICE_PER_MILLION || !env.AI_OUTPUT_PRICE_PER_MILLION) throw new Error("Exact AI token prices are required before paid calls."); return inputTokens * env.AI_INPUT_PRICE_PER_MILLION / 1_000_000 + outputTokens * env.AI_OUTPUT_PRICE_PER_MILLION / 1_000_000; }
export const usageHooks: AIHooks = {
  async beforeRequest(inputChars, maxOutputTokens, model, operation) { const env = config(); const reservationId = randomUUID(); const inputEstimate = Math.ceil(inputChars / 3); const reserved = estimatedCost(inputEstimate, maxOutputTokens); await db.$transaction(async transaction => { await transaction.$executeRaw`SELECT pg_advisory_xact_lock(74291001)`; const aggregate = await transaction.aIUsage.aggregate({ where: { calendarDate: todayParis(), status: { in: ["RESERVED", "COMPLETED"] } }, _sum: { reservedCost: true }, _count: true }); if (aggregate._count >= env.MAX_AI_ANALYSES_PER_DAY) throw new Error("Daily AI request limit reached."); const spent = Number(aggregate._sum.reservedCost ?? 0); if (spent + reserved > env.MAX_LLM_COST_PER_DAY) throw new Error("Daily AI cost limit reached."); await transaction.aIUsage.create({ data: { calendarDate: todayParis(), provider: env.AI_PROVIDER, model, operation, status: "RESERVED", reservationId, reservedCost: new Prisma.Decimal(reserved), estimatedCost: new Prisma.Decimal(reserved) } }); }); return reservationId; },
  async afterRequest(reservationId: string, usage: Usage) { const actual = estimatedCost(usage.inputTokens, usage.outputTokens); await db.aIUsage.update({ where: { reservationId }, data: { status: "COMPLETED", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, estimatedCost: new Prisma.Decimal(actual) } }); }
};
