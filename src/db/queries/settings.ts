import { eq } from "drizzle-orm";
import type { Db } from "../client";
import { settings } from "../schema";
import { nowIso } from "@/lib/time";

export type SystemPause = { paused: boolean; reason: string | null; since: string | null; by: string | null };

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting<T>(db: Db, key: string, value: T): void {
  const now = nowIso();
  db.insert(settings)
    .values({ key, value: JSON.stringify(value), updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value: JSON.stringify(value), updatedAt: now } })
    .run();
}

const PAUSE_KEY = "system.pause";

export function getPause(db: Db): SystemPause {
  return getSetting<SystemPause>(db, PAUSE_KEY, { paused: false, reason: null, since: null, by: null });
}

export function pauseSystem(db: Db, reason: string, by: string): void {
  setSetting<SystemPause>(db, PAUSE_KEY, { paused: true, reason, since: nowIso(), by });
}

export function resumeSystem(db: Db): void {
  setSetting<SystemPause>(db, PAUSE_KEY, { paused: false, reason: null, since: null, by: null });
}

/** Operating limits the operator may tighten in the panel. The .env values are the ceiling. */
export type OperatingLimits = {
  maxDmsPerDay: number;
  minSecondsBetweenDms: number;
  maxSecondsBetweenDms: number;
  operatingHours: string;
};

export function getLimitsOverride(db: Db): Partial<OperatingLimits> {
  return getSetting<Partial<OperatingLimits>>(db, "limits.override", {});
}

export function setLimitsOverride(db: Db, value: Partial<OperatingLimits>): void {
  setSetting(db, "limits.override", value);
}

export function getWarmupStart(db: Db): string | null {
  return getSetting<string | null>(db, "warmup.startDate", null);
}

export function setWarmupStartIfMissing(db: Db, isoDate: string): void {
  if (!getWarmupStart(db)) setSetting(db, "warmup.startDate", isoDate);
}
