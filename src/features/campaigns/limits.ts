import { daysBetween, isWithinOperatingHours, nextOperatingInstant, randomIntBetween } from "@/lib/time";

export type LimitConfig = {
  maxDmsPerDay: number;
  minSecondsBetweenDms: number;
  maxSecondsBetweenDms: number;
  operatingHours: string;
  timeZone: string;
  warmupStartPerDay: number;
  warmupStepPerWeek: number;
};

/** Daily allowance grows by `warmupStepPerWeek` every 7 days since the first real send, capped at the max. */
export function dailyAllowance(config: LimitConfig, warmupStart: Date | null, now: Date): number {
  if (!warmupStart) return Math.min(config.warmupStartPerDay, config.maxDmsPerDay);
  const weeks = Math.floor(daysBetween(warmupStart, now) / 7);
  return Math.min(config.warmupStartPerDay + weeks * config.warmupStepPerWeek, config.maxDmsPerDay);
}

export type SendDecision =
  | { ok: true; waitSeconds: number }
  | { ok: false; reason: "outside_hours" | "daily_cap" | "spacing"; retryAt: Date };

/** Whether a browser DM may go out now, and how long to wait first. Pure, so it is unit-tested. */
export function decideSend(
  input: { config: LimitConfig; sentToday: number; allowanceToday: number; lastSentAt: Date | null; now: Date },
  random: () => number = Math.random,
): SendDecision {
  const { config, now } = input;
  if (!isWithinOperatingHours(now, config.operatingHours, config.timeZone)) {
    return { ok: false, reason: "outside_hours", retryAt: nextOperatingInstant(now, config.operatingHours, config.timeZone) };
  }
  if (input.sentToday >= input.allowanceToday) {
    const tomorrow = new Date(now.getTime() + 60 * 60 * 1000);
    return { ok: false, reason: "daily_cap", retryAt: nextOperatingInstant(startOfNextDayUtc(now, tomorrow), config.operatingHours, config.timeZone) };
  }
  const spacing = randomIntBetween(config.minSecondsBetweenDms, config.maxSecondsBetweenDms, random);
  if (input.lastSentAt) {
    const elapsed = (now.getTime() - input.lastSentAt.getTime()) / 1000;
    if (elapsed < config.minSecondsBetweenDms) {
      return { ok: false, reason: "spacing", retryAt: new Date(input.lastSentAt.getTime() + spacing * 1000) };
    }
    const remaining = Math.max(spacing - elapsed, 0);
    return { ok: true, waitSeconds: Math.round(remaining) };
  }
  return { ok: true, waitSeconds: randomIntBetween(5, 30, random) };
}

function startOfNextDayUtc(now: Date, fallback: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return next > fallback ? next : fallback;
}

/** Typing cadence that looks like a person: 40–120 ms per character plus a pause before sending. */
export function typingPlan(text: string, random: () => number = Math.random): { perCharMs: number[]; pauseBeforeSendMs: number } {
  const perCharMs = Array.from(text, () => randomIntBetween(40, 120, random));
  return { perCharMs, pauseBeforeSendMs: randomIntBetween(1200, 3500, random) };
}
