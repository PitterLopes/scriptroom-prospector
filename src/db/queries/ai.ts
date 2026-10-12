import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { aiCalls } from "../schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type AiCallRecord = {
  leadId?: string | null;
  purpose: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  latencyMs: number;
  ok: boolean;
  error?: string | null;
};

export function recordAiCall(db: Db, record: AiCallRecord): void {
  db.insert(aiCalls)
    .values({
      id: newId(),
      leadId: record.leadId ?? null,
      purpose: record.purpose,
      model: record.model,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      costUsd: record.costUsd,
      latencyMs: record.latencyMs,
      ok: record.ok,
      error: record.error ?? null,
      createdAt: nowIso(),
    })
    .run();
}

/** Spend since the first instant of the current UTC month. */
export function monthlySpendUsd(db: Db, now: Date = new Date()): number {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, monthStart))
    .get();
  return row?.total ?? 0;
}

export function spendByPurpose(db: Db, now: Date = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  return db
    .select({
      purpose: aiCalls.purpose,
      model: aiCalls.model,
      calls: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)`,
      failures: sql<number>`sum(case when ${aiCalls.ok} = 0 then 1 else 0 end)`,
    })
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, monthStart))
    .groupBy(aiCalls.purpose, aiCalls.model)
    .all();
}

export function leadSpendUsd(db: Db, leadId: string): number {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)` })
    .from(aiCalls)
    .where(and(eq(aiCalls.leadId, leadId), eq(aiCalls.ok, true)))
    .get();
  return row?.total ?? 0;
}

export function recentAiCalls(db: Db, limit = 50) {
  return db.select().from(aiCalls).orderBy(desc(aiCalls.createdAt)).limit(limit).all();
}
