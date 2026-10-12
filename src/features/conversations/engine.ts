import type { Db } from "@/db/client";
import type { Lead, Message } from "@/db/schema";
import type { BusinessConfig } from "@/lib/config";
import { OpenRouterClient } from "@/integrations/openrouter/client";
import {
  CLASSIFY_SCHEMA,
  DECIDE_SCHEMA,
  OPENING_SCHEMA,
  classifyPrompt,
  decidePrompt,
  followUpPrompt,
  openingPrompt,
  recentPostsOf,
  type OpeningVariantConfig,
  type Stage,
} from "@/integrations/openrouter/prompts";
import { ACTIONS, INTENTS, defaultActionFor, type ConversationAction, type Intent } from "./intents";
import { checkClaims } from "./claims-guard";
import { recordLeadEvent } from "@/db/queries/events";

export type Classification = { intent: Intent; confidence: number; summary: string; objection: string | null };

export type Decision = {
  action: ConversationAction;
  reply: string | null;
  followUpHours: number | null;
  pipelineHint: "none" | "interested" | "closed";
  reasoning: string;
  guardViolations: string[];
};

export class ClaimsGuardError extends Error {
  constructor(readonly violations: string[]) {
    super(`Reply refused by the claims guard: ${violations.join(", ")}`);
    this.name = "ClaimsGuardError";
  }
}

/** Opt-out is detected in code too: the model must never be the only thing between "para" and a follow-up. */
export function looksLikeOptOut(text: string): boolean {
  const t = text.toLowerCase();
  return /\b(para(r)? de (me )?(mandar|enviar|escrever|procurar)|n[ãa]o me mande|n[ãa]o quero (mais )?receber|n[ãa]o tenho interesse nenhum|me tira|remove|remova|unsubscribe|stop|pare|parem|n[ãa]o me procure|me deixa em paz|spam|den[úu]ncia|vou denunciar|bloquear)\b/.test(t);
}

/**
 * The conversation engine: the only place that talks to the models about a lead.
 * Every outbound text passes through the claims guard; a refused text is retried once with the violations
 * spelled out, and refused again means the lead goes to human review instead of getting a risky message.
 */
export class ConversationEngine {
  constructor(
    private readonly db: Db,
    private readonly ai: OpenRouterClient,
    private readonly config: BusinessConfig,
  ) {}

  async writeOpening(lead: Lead, variant: OpeningVariantConfig): Promise<{ message: string; detailUsed: string }> {
    const prompt = openingPrompt(lead, variant, this.config);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const posts = recentPostsOf(lead);
      const result = await this.ai.call<{ post_index: number; detail_used: string; message: string }>({
        purpose: "opening",
        tier: "main",
        system: attempt === 0 ? prompt.system : `${prompt.system}\n\nA tentativa anterior foi recusada pelo verificador. Reescreva mais simples, sem produto, sem link, sem número.`,
        user: prompt.user,
        schema: OPENING_SCHEMA,
        maxTokens: 700,
        temperature: 0.8,
        leadId: lead.id,
      });
      const message = result.json.message.trim();
      const guard = checkClaims(message, this.config);
      const tooLong = message.length > 520;
      const hasLink = /https?:\/\//i.test(message);
      const postMissing = posts.length > 0 && !(result.json.post_index >= 1 && result.json.post_index <= posts.length);
      if (guard.ok && !tooLong && !hasLink && !postMissing) {
        const post = posts[result.json.post_index - 1];
        return { message, detailUsed: post ? `post ${result.json.post_index} (${post.url}): ${result.json.detail_used}` : result.json.detail_used };
      }
      recordLeadEvent(this.db, lead.id, "opening_refused", "ai", {
        attempt,
        violations: [...(guard.ok ? [] : guard.violations), ...(tooLong ? ["too_long"] : []), ...(hasLink ? ["link_in_opening"] : []), ...(postMissing ? ["no_real_post_referenced"] : [])],
      });
    }
    throw new ClaimsGuardError(["opening_refused_twice"]);
  }

  async classify(lead: Lead, inboundText: string, history: Message[]): Promise<Classification> {
    if (looksLikeOptOut(inboundText)) {
      return { intent: "opt_out", confidence: 1, summary: "Pediu para parar (detectado em código).", objection: null };
    }
    const prompt = classifyPrompt(inboundText, history);
    const result = await this.ai.call<{ intent: string; confidence: number; summary: string; objection: string }>({
      purpose: "classify",
      tier: "fast",
      system: prompt.system,
      user: prompt.user,
      schema: CLASSIFY_SCHEMA,
      maxTokens: 200,
      temperature: 0,
      leadId: lead.id,
    });
    const intent = (INTENTS as readonly string[]).includes(result.json.intent) ? (result.json.intent as Intent) : "ambiguous";
    return {
      intent,
      confidence: Math.max(0, Math.min(1, result.json.confidence)),
      summary: result.json.summary,
      objection: result.json.objection?.trim() ? result.json.objection.trim() : null,
    };
  }

  async decide(lead: Lead, history: Message[], intent: Intent, stage: Stage): Promise<Decision> {
    if (intent === "opt_out") {
      return { action: "close", reply: null, followUpHours: null, pipelineHint: "closed", reasoning: "opt-out", guardViolations: [] };
    }
    if (intent === "needs_human") {
      return { action: "escalate_to_human", reply: null, followUpHours: null, pipelineHint: "none", reasoning: "needs human", guardViolations: [] };
    }
    let violations: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const prompt = stage === "follow_up" ? followUpPrompt(lead, history, this.config) : decidePrompt(lead, history, intent, stage, this.config, attempt > 0 ? violations : undefined);
      const result = await this.ai.call<{ action: string; reply: string; follow_up_hours: number; pipeline_hint: string; reasoning: string }>({
        purpose: stage === "follow_up" ? "follow_up" : "decide",
        tier: "main",
        system: prompt.system,
        user: prompt.user,
        schema: DECIDE_SCHEMA,
        maxTokens: 500,
        temperature: 0.5,
        leadId: lead.id,
      });
      const action = (ACTIONS as readonly string[]).includes(result.json.action) ? (result.json.action as ConversationAction) : defaultActionFor(intent);
      const reply = result.json.reply.trim() || null;
      const sendsText = !["wait", "close", "escalate_to_human"].includes(action) || (action === "close" && intent === "not_interested");
      if (reply && sendsText) {
        const guard = checkClaims(reply, this.config);
        const linkOnlyWhenAsked = /https?:\/\//i.test(reply) && !["send_store_link", "send_whatsapp_link"].includes(action);
        violations = [...(guard.ok ? [] : guard.violations), ...(linkOnlyWhenAsked ? ["link_without_matching_action"] : []), ...(reply.length > 600 ? ["too_long"] : [])];
        if (violations.length > 0) {
          recordLeadEvent(this.db, lead.id, "reply_refused", "ai", { attempt, violations, action });
          continue;
        }
      }
      const hint = ["none", "interested", "closed"].includes(result.json.pipeline_hint) ? (result.json.pipeline_hint as Decision["pipelineHint"]) : "none";
      return {
        action,
        reply: sendsText ? reply : null,
        followUpHours: action === "schedule_follow_up" ? Math.max(24, Math.min(result.json.follow_up_hours || 48, 168)) : null,
        pipelineHint: hint,
        reasoning: result.json.reasoning,
        guardViolations: [],
      };
    }
    return { action: "escalate_to_human", reply: null, followUpHours: null, pipelineHint: "none", reasoning: "reply refused twice by the claims guard", guardViolations: violations };
  }
}
