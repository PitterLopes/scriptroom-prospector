import { enqueue, parsePayload } from "@/db/queries/jobs";
import { getLead, getLeadByIgUserId, getLeadByUsername, getOrCreateConversation, insertMessage, linkIgUserId, listMessages, markDoNotContact, moveChannel, movePipeline, updateConversation, updateLeadFields } from "@/db/queries/leads";
import { audit, raiseException, recordLeadEvent } from "@/db/queries/events";
import { apiWindowExpiry } from "@/integrations/instagram/graph";
import { BudgetExceededError } from "@/integrations/openrouter/client";
import type { Lead } from "@/db/schema";
import type { Funnel, PipelineState } from "@/features/leads/states";
import { canMovePipeline } from "@/features/leads/states";
import { addSeconds } from "@/lib/time";
import type { WorkerContext } from "../context";
import { isSystemPaused, noteOptOut } from "../safety";
import { done, postpone, type JobHandler } from "./types";

export type InboundPayload = { mid: string; senderId: string; recipientId: string; text: string | null; timestamp: string; attachments: number };

/**
 * A reply arrived through the official webhook. Match it to a lead, hand the channel to the API,
 * classify, decide, and queue the reply as its own idempotent job. Personal conversations that were never
 * prospected are ignored on purpose: the system never answers DMs it did not start.
 */
export const processInbound: JobHandler = async (job, ctx) => {
  const payload = parsePayload<InboundPayload>(job);
  const now = ctx.now();
  const lead = await matchLead(ctx, payload);
  if (!lead) {
    audit(ctx.db, "webhook", "inbound_unmatched", payload.senderId, { mid: payload.mid });
    return done("not a prospected lead; ignored");
  }
  if (lead.channelState === "do_not_contact" || lead.channelState === "blocked") return done(`lead is ${lead.channelState}`);

  const text = payload.text?.trim() || (payload.attachments > 0 ? "[anexo sem texto]" : "");
  const inserted = insertMessage(ctx.db, { leadId: lead.id, direction: "inbound", channel: "api", text, status: "received", externalId: payload.mid, sentAt: payload.timestamp });
  if (!inserted) return done("duplicate webhook event");

  const conversation = getOrCreateConversation(ctx.db, lead.id);
  updateConversation(ctx.db, conversation.id, { apiWindowExpiresAt: apiWindowExpiry(payload.timestamp), lastInboundAt: payload.timestamp });

  let current = lead;
  if (["browser_contact_pending", "browser_contact_sent", "waiting_inbound_reply"].includes(current.channelState)) {
    if (current.channelState !== "waiting_inbound_reply") current = moveChannel(ctx.db, current, current.channelState === "browser_contact_pending" ? "browser_contact_sent" : "waiting_inbound_reply", "webhook", "reply arrived");
    if (current.channelState === "browser_contact_sent") current = moveChannel(ctx.db, current, "waiting_inbound_reply", "webhook");
    current = moveChannel(ctx.db, current, "api_eligible", "webhook", "handoff: browser → API");
    current = moveChannel(ctx.db, current, "api_active", "webhook");
    recordLeadEvent(ctx.db, current.id, "channel_handoff", "webhook", { from: "browser", to: "api", mid: payload.mid });
  } else if (current.channelState === "api_window_closed" || current.channelState === "api_eligible") {
    current = moveChannel(ctx.db, current, "api_active", "webhook", "new inbound reopened the window");
  }
  if (current.pipelineState === "contacted" || current.pipelineState === "qualified") {
    current = movePipelineSafe(ctx, current, "replied", "lead replied");
  }
  if (current.channelState === "human_review_required") {
    raiseException(ctx.db, "human_review", `@${current.username} respondeu enquanto estava em revisão humana`, { leadId: current.id, payload: { text } });
    return done("in human review; stored only");
  }
  if (!text) return done("inbound without text stored");
  if (isSystemPaused(ctx.db)) return postpone(addSeconds(now, 10 * 60), "system paused");

  const history = listMessages(ctx.db, current.id).filter((m) => m.status !== "dry_run" && m.status !== "failed" && m.status !== "planned");
  try {
    const classification = await ctx.engine().classify(current, text, history.slice(0, -1));
    updateConversation(ctx.db, conversation.id, { lastIntent: classification.intent, summary: classification.summary });
    recordLeadEvent(ctx.db, current.id, "intent_classified", "ai", { ...classification, mid: payload.mid });

    if (classification.intent === "opt_out") {
      markDoNotContact(ctx.db, current, "pediu para parar", "ai");
      noteOptOut(ctx.db, now);
      return done("opt-out honored");
    }

    const stage = history.filter((m) => m.direction === "inbound").length <= 1 ? "first_reply" : "ongoing";
    const decision = await ctx.engine().decide(current, history, classification.intent, stage);
    recordLeadEvent(ctx.db, current.id, "ai_decision", "ai", { action: decision.action, reasoning: decision.reasoning, pipelineHint: decision.pipelineHint, hasReply: Boolean(decision.reply) });

    if (decision.pipelineHint === "interested" && current.pipelineState === "replied") current = movePipelineSafe(ctx, current, "interested", decision.reasoning);
    if (decision.action === "escalate_to_human") {
      moveChannel(ctx.db, current, "human_review_required", "ai", decision.reasoning);
      updateLeadFields(ctx.db, current.id, { nextAction: "Responder manualmente", nextActionAt: now.toISOString() });
      raiseException(ctx.db, "human_review", `@${current.username} precisa de resposta humana: ${decision.reasoning}`, { leadId: current.id, payload: { text, violations: decision.guardViolations } });
      return done("escalated to human");
    }
    if (decision.reply) {
      enqueue(ctx.db, "send_api_reply", { leadId: current.id, text: decision.reply, dedupeKey: `reply:${payload.mid}`, action: decision.action }, { idempotencyKey: `reply:${payload.mid}`, leadId: current.id, maxAttempts: 4 });
    }
    if (decision.action === "schedule_follow_up" && decision.followUpHours) {
      updateLeadFields(ctx.db, current.id, { nextAction: "Follow-up", nextActionAt: addSeconds(now, decision.followUpHours * 3600).toISOString() });
    } else if (decision.action === "close") {
      const closed = movePipelineSafe(ctx, current, "closed", decision.reasoning);
      moveChannel(ctx.db, closed, "completed", "ai", decision.reasoning);
      updateLeadFields(ctx.db, current.id, { nextAction: null, nextActionAt: null });
    } else if (decision.action === "send_store_link") {
      updateLeadFields(ctx.db, current.id, { nextAction: "Acompanhar instalação", nextActionAt: addSeconds(now, 72 * 3600).toISOString() });
    } else {
      updateLeadFields(ctx.db, current.id, { nextAction: "Aguardar resposta", nextActionAt: null });
    }
    return done(`intent ${classification.intent} → ${decision.action}`);
  } catch (error: unknown) {
    if (error instanceof BudgetExceededError) return postpone(addSeconds(now, 60 * 60), "AI budget reached");
    throw error;
  }
};

async function matchLead(ctx: WorkerContext, payload: InboundPayload): Promise<Lead | null> {
  const byId = getLeadByIgUserId(ctx.db, payload.senderId);
  if (byId) return byId;
  const graph = ctx.graph();
  if (!graph) return null;
  const profile = await graph.getUserProfile(payload.senderId).catch(() => null);
  if (!profile?.username) return null;
  const lead = getLeadByUsername(ctx.db, profile.username);
  if (!lead) return null;
  linkIgUserId(ctx.db, lead.id, payload.senderId);
  recordLeadEvent(ctx.db, lead.id, "ig_user_id_linked", "webhook", { igUserId: payload.senderId });
  return getLead(ctx.db, lead.id);
}

function movePipelineSafe(ctx: WorkerContext, lead: Lead, to: PipelineState, reason: string): Lead {
  return canMovePipeline(lead.funnel as Funnel, lead.pipelineState as PipelineState, to) ? movePipeline(ctx.db, lead, to, "ai", reason) : lead;
}
