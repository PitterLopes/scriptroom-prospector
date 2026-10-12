import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "../client";
import { auditLog, exceptions, leadEvents } from "../schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type Actor = "worker" | "operator" | "ai" | "webhook" | "browser";

export function recordLeadEvent(db: Db, leadId: string, type: string, actor: Actor, payload: Record<string, unknown> = {}): void {
  db.insert(leadEvents)
    .values({ id: newId(), leadId, type, actor, payload: JSON.stringify(payload), createdAt: nowIso() })
    .run();
}

export function listLeadEvents(db: Db, leadId: string) {
  return db.select().from(leadEvents).where(eq(leadEvents.leadId, leadId)).orderBy(desc(leadEvents.createdAt)).all();
}

export function audit(db: Db, actor: Actor, action: string, target: string | null, details: Record<string, unknown> = {}): void {
  db.insert(auditLog)
    .values({ id: newId(), actor, action, target, details: JSON.stringify(details), createdAt: nowIso() })
    .run();
}

export function listAudit(db: Db, limit = 200) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit).all();
}

export function raiseException(
  db: Db,
  kind: string,
  message: string,
  extra: { leadId?: string | null; jobId?: string | null; payload?: Record<string, unknown> } = {},
): string {
  const id = newId();
  db.insert(exceptions)
    .values({
      id,
      kind,
      message,
      leadId: extra.leadId ?? null,
      jobId: extra.jobId ?? null,
      payload: JSON.stringify(extra.payload ?? {}),
      createdAt: nowIso(),
    })
    .run();
  return id;
}

export function listOpenExceptions(db: Db) {
  return db.select().from(exceptions).where(isNull(exceptions.resolvedAt)).orderBy(desc(exceptions.createdAt)).all();
}

export function countOpenExceptions(db: Db): number {
  return listOpenExceptions(db).length;
}

export function resolveException(db: Db, id: string): void {
  db.update(exceptions).set({ resolvedAt: nowIso() }).where(and(eq(exceptions.id, id), isNull(exceptions.resolvedAt))).run();
}
