import { parsePayload, enqueue } from "@/db/queries/jobs";
import { getLead, getOrCreateConversation, listMessages, moveChannel, movePipeline, updateConversation, updateLeadFields } from "@/db/queries/leads";
import { raiseException, recordLeadEvent } from "@/db/queries/events";
import { apiWindowOpen } from "@/integrations/instagram/graph";
import { MAX_FOLLOW_UPS } from "@/features/conversations/intents";
import { CLOSE_AFTER_FOLLOW_UP_HOURS } from "@/features/conversations/timing";
import { canMovePipeline, type Funnel, type PipelineState } from "@/features/leads/states";
import { BudgetExceededError } from "@/integrations/openrouter/client";
import { addSeconds } from "@/lib/time";
import { isSystemPaused } from "../safety";
import { done, postpone, type JobHandler } from "./types";

/**
 * Follow-up only to people who replied and went quiet, only through the API, only inside Meta's window.
 * Outside the window the system does not try the browser; it tells the operator.
 */
export const followUp: JobHandler = async (job, ctx) => {
  const { leadId } = parsePayload<{ leadId: string }>(job);
  const now = ctx.now();
  const lead = getLead(ctx.db, leadId);
  if (!lead) return done("lead no longer exists");
  if (lead.channelState !== "api_active") return done(`channel is ${lead.channelState}`);
  if (isSystemPaused(ctx.db)) return postpone(addSeconds(now, 10 * 60), "system paused");
  const conversation = getOrCreateConversation(ctx.db, lead.id);
  if (conversation.lastInboundAt && conversation.lastOutboundAt && conversation.lastInboundAt > conversation.lastOutboundAt) {
    updateLeadFields(ctx.db, lead.id, { nextAction: null, nextActionAt: null });
    return done("lead already replied; no follow-up needed");
  }
  if (conversation.followUpsSent >= MAX_FOLLOW_UPS) {
    // The one follow-up went out and the person stayed quiet. The test takes minutes: silence is the answer.
    const reason = "sem resposta depois do follow-up: o app não fez sentido para ela";
    const closed = canMovePipeline(lead.funnel as Funnel, lead.pipelineState as PipelineState, "closed") ? movePipeline(ctx.db, lead, "closed", "worker", reason) : lead;
    moveChannel(ctx.db, closed, "completed", "worker", reason);
    updateLeadFields(ctx.db, lead.id, { nextAction: null, nextActionAt: null });
    recordLeadEvent(ctx.db, lead.id, "closed_after_follow_up", "worker", { followUpsSent: conversation.followUpsSent });
    return done("no reply after the follow-up; closed");
  }
  if (!apiWindowOpen(conversation.apiWindowExpiresAt, now)) {
    moveChannel(ctx.db, lead, "api_window_closed", "worker", "follow-up outside the 24h window");
    updateLeadFields(ctx.db, lead.id, { nextAction: "Follow-up manual (janela da API fechada)", nextActionAt: now.toISOString() });
    raiseException(ctx.db, "api_window_closed", `Follow-up para @${lead.username} não pode ir pela API (janela de 24 h fechada). Se quiser, mande à mão.`, { leadId: lead.id, jobId: job.id });
    return done("window closed; operator notified");
  }
  try {
    const history = listMessages(ctx.db, lead.id).filter((m) => m.status === "sent" || m.status === "received");
    const decision = await ctx.engine().decide(lead, history, "interested", "follow_up");
    if (!decision.reply) return done(`no follow-up text (${decision.action})`);
    const dedupeKey = `followup:${lead.id}:${conversation.followUpsSent + 1}`;
    enqueue(ctx.db, "send_api_reply", { leadId: lead.id, text: decision.reply, dedupeKey, action: "follow_up" }, { idempotencyKey: dedupeKey, leadId: lead.id, maxAttempts: 3 });
    updateConversation(ctx.db, conversation.id, { followUpsSent: conversation.followUpsSent + 1 });
    updateLeadFields(ctx.db, lead.id, { nextAction: "Encerrar se não responder", nextActionAt: addSeconds(now, CLOSE_AFTER_FOLLOW_UP_HOURS * 3600).toISOString() });
    recordLeadEvent(ctx.db, lead.id, "follow_up_scheduled", "ai", { number: conversation.followUpsSent + 1, reasoning: decision.reasoning });
    return done("follow-up queued");
  } catch (error: unknown) {
    if (error instanceof BudgetExceededError) return postpone(addSeconds(now, 60 * 60), "AI budget reached");
    throw error;
  }
};
