import { and, eq, inArray, isNull } from "drizzle-orm";
import { messages } from "@/db/schema";
import { parsePayload } from "@/db/queries/jobs";
import { countBrowserDmsSentBetween, getLead, insertMessage, isDoNotContact, lastBrowserDmSentAt, moveChannel, movePipeline, updateLeadFields, updateMessage } from "@/db/queries/leads";
import { raiseException, recordLeadEvent } from "@/db/queries/events";
import { getLimitsOverride, getWarmupStart, setWarmupStartIfMissing } from "@/db/queries/settings";
import { assignVariant, ensureOpeningExperiment, variantConfig } from "@/features/experiments/queries";
import { dailyAllowance, decideSend, type LimitConfig } from "@/features/campaigns/limits";
import { ClaimsGuardError } from "@/features/conversations/engine";
import { BudgetExceededError } from "@/integrations/openrouter/client";
import { withBrowserLock } from "@/integrations/browser/lock";
import { BrowserUnavailableError, InstagramRestrictionError } from "@/integrations/browser/types";
import { addSeconds, startOfDayInZone } from "@/lib/time";
import type { WorkerContext } from "../context";
import { isBrowserPaused, isSystemPaused, noteSendFailure, pauseBrowser, tripOnDuplicate, tripOnRestriction } from "../safety";
import { done, postpone, type JobHandler } from "./types";

/** Up to this many seconds the job waits in place (it already holds its slot); longer waits go back to the queue. */
const INLINE_WAIT_MAX_SECONDS = 45;

export function limitConfig(ctx: WorkerContext): LimitConfig {
  const override = getLimitsOverride(ctx.db);
  const e = ctx.env;
  return {
    maxDmsPerDay: Math.min(override.maxDmsPerDay ?? e.MAX_DMS_PER_DAY, e.MAX_DMS_PER_DAY),
    minSecondsBetweenDms: Math.max(override.minSecondsBetweenDms ?? e.MIN_SECONDS_BETWEEN_DMS, e.MIN_SECONDS_BETWEEN_DMS),
    maxSecondsBetweenDms: Math.max(override.maxSecondsBetweenDms ?? e.MAX_SECONDS_BETWEEN_DMS, e.MIN_SECONDS_BETWEEN_DMS),
    operatingHours: override.operatingHours ?? e.OPERATING_HOURS,
    timeZone: e.OPERATING_TIMEZONE,
    warmupStartPerDay: e.WARMUP_START_PER_DAY,
    warmupStepPerWeek: e.WARMUP_STEP_PER_WEEK,
  };
}

export function sentToday(ctx: WorkerContext, now: Date): number {
  const start = startOfDayInZone(now, ctx.env.OPERATING_TIMEZONE);
  return countBrowserDmsSentBetween(ctx.db, start.toISOString(), now.toISOString());
}

export function allowanceToday(ctx: WorkerContext, now: Date): number {
  const warmup = getWarmupStart(ctx.db);
  return dailyAllowance(limitConfig(ctx), warmup ? new Date(warmup) : null, now);
}

/**
 * The first contact. Order matters: eligibility → limits → variant → AI text → claims guard → dedupe row →
 * browser send (or dry-run) → state. The dedupe row exists before the browser acts, so a crash in between
 * can never produce a second DM to the same person.
 */
export const sendFirstDm: JobHandler = async (job, ctx) => {
  const { leadId } = parsePayload<{ leadId: string }>(job);
  const now = ctx.now();
  const lead = getLead(ctx.db, leadId);
  if (!lead) return done("lead no longer exists");
  if (lead.pipelineState !== "qualified" || lead.channelState !== "browser_contact_pending") return done(`not eligible (${lead.pipelineState}/${lead.channelState})`);
  if (isDoNotContact(ctx.db, lead.username)) return done("do not contact");
  if ((JSON.parse(lead.tags) as string[]).includes("dry_run")) return done("already simulated");
  if (isSystemPaused(ctx.db)) return postpone(addSeconds(now, 10 * 60), "system paused");
  if (isBrowserPaused(ctx.db)) return postpone(addSeconds(now, 15 * 60), "browser queue paused");

  const config = limitConfig(ctx);
  const last = lastBrowserDmSentAt(ctx.db);
  const decision = decideSend({ config, sentToday: sentToday(ctx, now), allowanceToday: allowanceToday(ctx, now), lastSentAt: last ? new Date(last) : null, now }, ctx.random);
  if (!decision.ok) return postpone(decision.retryAt, decision.reason);
  if (decision.waitSeconds > INLINE_WAIT_MAX_SECONDS) return postpone(addSeconds(now, decision.waitSeconds), `spacing ${decision.waitSeconds}s`);

  const experiment = ensureOpeningExperiment(ctx.db, "customers");
  const variant = assignVariant(ctx.db, experiment, lead.id, ctx.random);

  let text: string;
  try {
    const opening = await ctx.engine().writeOpening(lead, variantConfig(variant));
    text = opening.message;
    recordLeadEvent(ctx.db, lead.id, "opening_written", "ai", { variant: variant.name, detailUsed: opening.detailUsed, chars: text.length });
  } catch (error: unknown) {
    if (error instanceof BudgetExceededError) return postpone(addSeconds(now, 60 * 60), "AI budget reached");
    if (error instanceof ClaimsGuardError) {
      moveChannel(ctx.db, lead, "human_review_required", "worker", "opening refused by claims guard");
      raiseException(ctx.db, "claims_guard", `Opening for @${lead.username} refused twice`, { leadId: lead.id, payload: { violations: error.violations } });
      return done("escalated: opening refused");
    }
    throw error;
  }

  const dryRun = !ctx.sendEnabled();
  if (decision.waitSeconds > 0) await ctx.sleep(decision.waitSeconds * 1000);
  // A row left "planned" by an interrupted attempt is not a send: free its key. Only sent or simulated rows block.
  ctx.db.update(messages).set({ dedupeKey: null }).where(and(eq(messages.dedupeKey, `first_dm:${lead.id}`), inArray(messages.status, ["planned", "failed"]), isNull(messages.sentAt))).run();
  const row = insertMessage(ctx.db, { leadId: lead.id, direction: "outbound", channel: "browser", text, status: "planned", dedupeKey: `first_dm:${lead.id}`, variantId: variant.id });
  if (!row) {
    tripOnDuplicate(ctx.db, `first DM for @${lead.username} already exists`);
    return done("duplicate blocked");
  }

  try {
    const outcome = await withBrowserLock(async () => {
      const browser = ctx.browser();
      await browser.connect();
      return browser.sendDirectMessage(lead.username, text, { dryRun, jobId: job.id, random: ctx.random, followFirst: ctx.env.FOLLOW_BEFORE_DM });
    });
    if (outcome.status === "sent") {
      updateMessage(ctx.db, row.id, { status: "sent", sentAt: outcome.sentAt });
      setWarmupStartIfMissing(ctx.db, outcome.sentAt);
      const contacted = movePipeline(ctx.db, lead, "contacted", "browser", "first DM sent");
      const sent = moveChannel(ctx.db, contacted, "browser_contact_sent", "browser");
      moveChannel(ctx.db, sent, "waiting_inbound_reply", "browser");
      updateLeadFields(ctx.db, lead.id, { nextAction: "Aguardar resposta", nextActionAt: null, followedAt: outcome.followed ? outcome.sentAt : lead.followedAt });
      if (outcome.followed) recordLeadEvent(ctx.db, lead.id, "followed", "browser", { before: "first_dm" });
      recordLeadEvent(ctx.db, lead.id, "first_dm_sent", "browser", { variant: variant.name, text, sentAt: outcome.sentAt, followed: outcome.followed });
      return done("sent");
    }
    if (outcome.status === "dry_run") {
      updateMessage(ctx.db, row.id, { status: "dry_run" });
      const tags = [...new Set([...(JSON.parse(lead.tags) as string[]), "dry_run"])];
      updateLeadFields(ctx.db, lead.id, { tags: JSON.stringify(tags), nextAction: "Simulado: ligue o envio real para contatar", nextActionAt: null });
      recordLeadEvent(ctx.db, lead.id, "first_dm_dry_run", "browser", { variant: variant.name, text, typedChars: outcome.typedChars });
      return done("dry-run");
    }
    updateMessage(ctx.db, row.id, { status: "failed", error: outcome.error });
    releaseDedupeKey(ctx, row.id);
    moveChannel(ctx.db, lead, "human_review_required", "worker", outcome.error);
    raiseException(ctx.db, "send_failed", `First DM to @${lead.username} failed: ${outcome.error}`, { leadId: lead.id, jobId: job.id, payload: { ...outcome.artifacts, text } });
    noteSendFailure(ctx.db, now);
    return done("failed; escalated");
  } catch (error: unknown) {
    updateMessage(ctx.db, row.id, { status: "failed", error: error instanceof Error ? error.message : String(error) });
    if (error instanceof BrowserUnavailableError) {
      pauseBrowser(ctx.db, error.message);
      resetForRetry(ctx, row.id);
      return postpone(addSeconds(now, 15 * 60), error.message);
    }
    if (error instanceof InstagramRestrictionError) {
      tripOnRestriction(ctx.db, `${error.message}${error.detail ? ` — ${error.detail}` : ""}`);
      moveChannel(ctx.db, lead, "human_review_required", "worker", "restriction during send");
      return done("restriction; system paused");
    }
    throw error;
  }
};

/** A browser outage is not a send: free the dedupe row so the retry can plan the message again. */
function resetForRetry(ctx: WorkerContext, messageId: string): void {
  ctx.db.delete(messages).where(and(eq(messages.id, messageId), isNull(messages.sentAt))).run();
}

/** A failed attempt stays in the timeline but must not block the retry: only a sent message keeps the key. */
function releaseDedupeKey(ctx: WorkerContext, messageId: string): void {
  ctx.db.update(messages).set({ dedupeKey: null }).where(and(eq(messages.id, messageId), isNull(messages.sentAt))).run();
}
