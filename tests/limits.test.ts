import { describe, expect, it } from "vitest";
import { dailyAllowance, decideSend, typingPlan, type LimitConfig } from "@/features/campaigns/limits";
import { isWithinOperatingHours, nextOperatingInstant, startOfDayInZone } from "@/lib/time";

const config: LimitConfig = { maxDmsPerDay: 30, minSecondsBetweenDms: 90, maxSecondsBetweenDms: 240, operatingHours: "09:00-20:00", timeZone: "America/Sao_Paulo", warmupStartPerDay: 5, warmupStepPerWeek: 5 };
const noon = new Date("2026-10-12T15:00:00Z"); // 12:00 in São Paulo

describe("warmup", () => {
  it("starts at 5 and grows 5 per week up to the cap", () => {
    expect(dailyAllowance(config, null, noon)).toBe(5);
    const start = new Date("2026-10-01T12:00:00Z");
    expect(dailyAllowance(config, start, new Date("2026-10-05T12:00:00Z"))).toBe(5);
    expect(dailyAllowance(config, start, new Date("2026-10-09T12:00:00Z"))).toBe(10);
    expect(dailyAllowance(config, start, new Date("2026-12-01T12:00:00Z"))).toBe(30);
  });
});

describe("decideSend", () => {
  it("refuses outside operating hours and points to the next opening", () => {
    const night = new Date("2026-10-12T02:00:00Z"); // 23:00 in São Paulo
    const decision = decideSend({ config, sentToday: 0, allowanceToday: 5, lastSentAt: null, now: night });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("outside_hours");
      expect(isWithinOperatingHours(decision.retryAt, config.operatingHours, config.timeZone)).toBe(true);
    }
  });
  it("refuses when the daily cap is reached", () => {
    const decision = decideSend({ config, sentToday: 5, allowanceToday: 5, lastSentAt: null, now: noon });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe("daily_cap");
  });
  it("enforces random spacing between sends", () => {
    const justSent = new Date(noon.getTime() - 30_000);
    const decision = decideSend({ config, sentToday: 1, allowanceToday: 5, lastSentAt: justSent, now: noon }, () => 0.5);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("spacing");
      expect(decision.retryAt.getTime() - justSent.getTime()).toBeGreaterThanOrEqual(90_000);
    }
    const longAgo = new Date(noon.getTime() - 600_000);
    const ok = decideSend({ config, sentToday: 1, allowanceToday: 5, lastSentAt: longAgo, now: noon }, () => 0.5);
    expect(ok.ok).toBe(true);
  });
  it("typing plan looks human", () => {
    const plan = typingPlan("olá", () => 0.5);
    expect(plan.perCharMs).toHaveLength(3);
    for (const ms of plan.perCharMs) expect(ms).toBeGreaterThanOrEqual(40);
    expect(plan.pauseBeforeSendMs).toBeGreaterThanOrEqual(1200);
  });
});

describe("time helpers", () => {
  it("finds local midnight in the operator's zone", () => {
    const start = startOfDayInZone(noon, "America/Sao_Paulo");
    expect(start.toISOString()).toBe("2026-10-12T03:00:00.000Z");
  });
  it("next operating instant is 09:00 local", () => {
    const next = nextOperatingInstant(new Date("2026-10-12T02:00:00Z"), "09:00-20:00", "America/Sao_Paulo");
    expect(next.toISOString()).toBe("2026-10-12T12:00:00.000Z");
  });
});
