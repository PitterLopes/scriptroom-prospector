import type { Db } from "@/db/client";
import { getPause, getSetting, pauseSystem, setSetting } from "@/db/queries/settings";
import { audit, raiseException } from "@/db/queries/events";
import { logger } from "@/lib/logger";

const log = logger("safety");

const FAILURE_WINDOW_MS = 60 * 60 * 1000;
const MAX_SEND_FAILURES_PER_HOUR = 3;
const MAX_OPT_OUTS_PER_DAY = 3;

export function isSystemPaused(db: Db): boolean {
  return getPause(db).paused;
}

export function isBrowserPaused(db: Db): boolean {
  return getSetting<{ paused: boolean }>(db, "browser.pause", { paused: false }).paused;
}

export function pauseBrowser(db: Db, reason: string): void {
  setSetting(db, "browser.pause", { paused: true, reason, since: new Date().toISOString() });
  raiseException(db, "browser_unavailable", reason);
  audit(db, "worker", "browser_paused", null, { reason });
  log.warn("browser queue paused", { reason });
}

export function resumeBrowser(db: Db): void {
  setSetting(db, "browser.pause", { paused: false });
}

/** Any Instagram restriction or lost session stops everything until the operator looks. */
export function tripOnRestriction(db: Db, detail: string): void {
  pauseSystem(db, `Instagram sinalizou restrição ou pediu login: ${detail}`, "worker");
  raiseException(db, "instagram_restriction", detail);
  audit(db, "worker", "system_paused", null, { reason: "instagram_restriction", detail });
}

function pushTimestamp(db: Db, key: string, windowMs: number, now: Date): number {
  const list = getSetting<string[]>(db, key, []).filter((iso) => now.getTime() - new Date(iso).getTime() < windowMs);
  list.push(now.toISOString());
  setSetting(db, key, list);
  return list.length;
}

export function noteSendFailure(db: Db, now: Date = new Date()): void {
  const count = pushTimestamp(db, "breaker.sendFailures", FAILURE_WINDOW_MS, now);
  if (count >= MAX_SEND_FAILURES_PER_HOUR) {
    pauseSystem(db, `${count} falhas de envio na última hora`, "worker");
    raiseException(db, "circuit_breaker", `${count} send failures within one hour`);
    audit(db, "worker", "system_paused", null, { reason: "send_failures", count });
  }
}

export function noteOptOut(db: Db, now: Date = new Date()): void {
  const count = pushTimestamp(db, "breaker.optOuts", 24 * FAILURE_WINDOW_MS, now);
  if (count >= MAX_OPT_OUTS_PER_DAY) {
    pauseSystem(db, `${count} pedidos de parar em 24 horas`, "worker");
    raiseException(db, "circuit_breaker", `${count} opt-outs within 24 hours`);
    audit(db, "worker", "system_paused", null, { reason: "opt_outs", count });
  }
}

/** A duplicate the unique constraints caught means two paths tried to send the same thing: stop and look. */
export function tripOnDuplicate(db: Db, detail: string): void {
  pauseSystem(db, `Tentativa de envio duplicado bloqueada: ${detail}`, "worker");
  raiseException(db, "duplicate_send_blocked", detail);
  audit(db, "worker", "system_paused", null, { reason: "duplicate_send", detail });
}
