import { enqueue } from "@/db/queries/jobs";
import { countQualifiedWaiting, leadsWithDueFollowUp, nextLeadsToContact } from "@/db/queries/leads";
import { getSetting } from "@/db/queries/settings";
import { isoDateInZone, nextOperatingInstant, startOfDayInZone } from "@/lib/time";
import type { WorkerContext } from "./context";
import { allowanceToday, limitConfig, sentToday } from "./handlers/first-dm";
import { isBrowserPaused, isSystemPaused } from "./safety";

export const DISCOVERY_PER_QUERY = 12;

/**
 * Turns configuration into due jobs. Idempotency keys carry the operator's date, so a tick can run every
 * few seconds without duplicating anything. Nothing is scheduled while the system is paused.
 */
export function scheduleTick(ctx: WorkerContext): { scheduled: number } {
  const now = ctx.now();
  const day = isoDateInZone(now, ctx.env.OPERATING_TIMEZONE);
  let scheduled = 0;
  const bump = (id: string | null) => {
    if (id) scheduled += 1;
  };

  bump(enqueue(ctx.db, "daily_backup", {}, { idempotencyKey: `backup:${day}`, maxAttempts: 2 }));
  bump(enqueue(ctx.db, "review_experiments", {}, { idempotencyKey: `review:${day}`, maxAttempts: 2 }));

  if (isSystemPaused(ctx.db)) return { scheduled };

  for (const lead of leadsWithDueFollowUp(ctx.db, now)) {
    bump(enqueue(ctx.db, "follow_up", { leadId: lead.id }, { idempotencyKey: `followup:${lead.id}:${lead.nextActionAt}`, leadId: lead.id, maxAttempts: 2 }));
  }

  if (isBrowserPaused(ctx.db)) return { scheduled };

  // Discover only what can be contacted: a backlog of qualified leads is days of DMs already, and every search is
  // a dozen page loads Instagram counts against the session. A few queries a day, rotating through the list.
  const discoveryEnabled = getSetting<boolean>(ctx.db, "discovery.enabled", true);
  const backlog = countQualifiedWaiting(ctx.db, "customers");
  if (discoveryEnabled && backlog < ctx.env.DISCOVERY_BACKLOG_TARGET && ctx.env.DISCOVERY_QUERIES_PER_DAY > 0) {
    const config = limitConfig(ctx);
    const firstSlot = nextOperatingInstant(now, config.operatingHours, config.timeZone);
    const all = [...ctx.config.icp.hashtags.map((h) => `#${h}`), ...ctx.config.icp.keywords];
    const perDay = Math.min(ctx.env.DISCOVERY_QUERIES_PER_DAY, all.length);
    const dayNumber = Math.floor(startOfDayInZone(now, ctx.env.OPERATING_TIMEZONE).getTime() / 86_400_000);
    const queries = Array.from({ length: perDay }, (_, i) => all[(dayNumber * perDay + i) % all.length]!);
    queries.forEach((query, index) => {
      const runAt = new Date(firstSlot.getTime() + index * 20 * 60_000);
      bump(enqueue(ctx.db, "discover_profiles", { funnel: "customers", query, limit: DISCOVERY_PER_QUERY }, { idempotencyKey: `discover:${query}:${day}`, runAt, maxAttempts: 2 }));
    });
  }

  const remaining = Math.max(allowanceToday(ctx, now) - sentToday(ctx, now), 0);
  if (remaining > 0) {
    // Leads already simulated wait for the real switch; once sending is on, they are first in line.
    const sending = ctx.sendEnabled();
    for (const lead of nextLeadsToContact(ctx.db, "customers", remaining).filter((l) => sending || !(JSON.parse(l.tags) as string[]).includes("dry_run"))) {
      // The key carries the lead's last state change: a lead returned to the queue after a failure gets a new job;
      // an untouched lead never gets two.
      bump(enqueue(ctx.db, "send_first_dm", { leadId: lead.id }, { idempotencyKey: `first_dm:${lead.id}:${lead.updatedAt}`, leadId: lead.id, maxAttempts: 3 }));
    }
  }
  return { scheduled };
}
