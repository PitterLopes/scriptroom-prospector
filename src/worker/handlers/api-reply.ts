import { and, eq, isNull } from "drizzle-orm";
import { messages } from "@/db/schema";
import { parsePayload } from "@/db/queries/jobs";
import { getLead, getOrCreateConversation, insertMessage, isDoNotContact, moveChannel, updateMessage } from "@/db/queries/leads";
import { raiseException, recordLeadEvent } from "@/db/queries/events";
import { channelOwner, type ChannelState } from "@/features/leads/states";
import { checkClaims } from "@/features/conversations/claims-guard";
import { GraphApiError, apiWindowOpen } from "@/integrations/instagram/graph";
import { addSeconds } from "@/lib/time";
import { isSystemPaused, tripOnDuplicate } from "../safety";
import { done, fail, postpone, type JobHandler } from "./types";

export type ApiReplyPayload = { leadId: string; text: string; dedupeKey: string; action: string };

/**
 * Sends one reply through the official API. Checks, in order: pause, channel ownership, do-not-contact,
 * messaging window, claims guard (again, at the edge), dedupe row, then the call. Never falls back to the browser.
 */
export const sendApiReply: JobHandler = async (job, ctx) => {
  const payload = parsePayload<ApiReplyPayload>(job);
  const now = ctx.now();
  const lead = getLead(ctx.db, payload.leadId);
  if (!lead) return done("lead no longer exists");
  if (isSystemPaused(ctx.db)) return postpone(addSeconds(now, 10 * 60), "system paused");
  if (isDoNotContact(ctx.db, lead.username) || lead.channelState === "do_not_contact") return done("do not contact");
  if (channelOwner(lead.channelState as ChannelState) !== "api") {
    raiseException(ctx.db, "channel_ownership", `Reply to @${lead.username} refused: channel is ${lead.channelState}, not owned by the API`, { leadId: lead.id, jobId: job.id, payload: { text: payload.text } });
    return done("channel not owned by api");
  }
  const graph = ctx.graph();
  if (!graph || !lead.igUserId) {
    raiseException(ctx.db, "api_not_configured", `Reply to @${lead.username} needs the official API (token or IG user id missing)`, { leadId: lead.id, jobId: job.id, payload: { text: payload.text } });
    moveChannel(ctx.db, lead, "human_review_required", "worker", "api not configured");
    return done("api not configured; escalated");
  }
  const conversation = getOrCreateConversation(ctx.db, lead.id);
  if (!apiWindowOpen(conversation.apiWindowExpiresAt, now)) {
    moveChannel(ctx.db, lead, "api_window_closed", "worker", "24h window expired before sending");
    raiseException(ctx.db, "api_window_closed", `Janela de 24 h fechada para @${lead.username}; a resposta não foi enviada`, { leadId: lead.id, jobId: job.id, payload: { text: payload.text } });
    return done("window closed");
  }
  const guard = checkClaims(payload.text, ctx.config);
  if (!guard.ok) {
    moveChannel(ctx.db, lead, "human_review_required", "worker", "claims guard at send time");
    raiseException(ctx.db, "claims_guard", `Reply to @${lead.username} blocked at send time: ${guard.violations.join(", ")}`, { leadId: lead.id, jobId: job.id, payload: { text: payload.text } });
    return done("blocked by claims guard");
  }
  const row = insertMessage(ctx.db, { leadId: lead.id, direction: "outbound", channel: "api", text: payload.text, status: "planned", dedupeKey: payload.dedupeKey });
  if (!row) {
    tripOnDuplicate(ctx.db, `API reply ${payload.dedupeKey} for @${lead.username} already exists`);
    return done("duplicate blocked");
  }
  try {
    const result = await graph.sendText(lead.igUserId, payload.text);
    updateMessage(ctx.db, row.id, { status: "sent", sentAt: now.toISOString(), externalId: result.messageId || null });
    recordLeadEvent(ctx.db, lead.id, "api_reply_sent", "ai", { action: payload.action, text: payload.text, messageId: result.messageId });
    return done("sent");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    updateMessage(ctx.db, row.id, { status: "failed", error: message });
    if (error instanceof GraphApiError && error.isWindowOrPolicyError) {
      moveChannel(ctx.db, lead, "api_window_closed", "worker", message);
      raiseException(ctx.db, "api_window_closed", `Meta recusou a mensagem para @${lead.username}: ${message}`, { leadId: lead.id, jobId: job.id, payload: { text: payload.text } });
      return done("meta refused; exception raised");
    }
    if (error instanceof GraphApiError && (error.status === 401 || error.status === 403 || error.code === 190)) {
      raiseException(ctx.db, "api_unauthorized", `Token da Meta recusado (${message}); a resposta para @${lead.username} ficou pendente`, { leadId: lead.id, jobId: job.id });
      return postpone(addSeconds(now, 30 * 60), "api unauthorized");
    }
    ctx.db.delete(messages).where(and(eq(messages.id, row.id), isNull(messages.sentAt))).run();
    return fail(message);
  }
};
