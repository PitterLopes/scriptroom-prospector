/** Pipeline and channel are separate fields. Internal values in English; the UI translates. */

export const FUNNELS = ["customers", "affiliates"] as const;
export type Funnel = (typeof FUNNELS)[number];

export const CUSTOMER_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "whatsapp_handoff",
  "registered",
  "active_customer",
  "closed",
] as const;

export const AFFILIATE_PIPELINE = [
  "discovered",
  "qualified",
  "contacted",
  "replied",
  "interested",
  "joined_affiliate_group",
  "active_affiliate",
  "generated_customer",
  "closed",
] as const;

export type CustomerPipelineState = (typeof CUSTOMER_PIPELINE)[number];
export type AffiliatePipelineState = (typeof AFFILIATE_PIPELINE)[number];
export type PipelineState = CustomerPipelineState | AffiliatePipelineState;

export const CHANNEL_STATES = [
  "browser_contact_pending",
  "browser_contact_sent",
  "waiting_inbound_reply",
  "api_eligible",
  "api_active",
  "api_window_closed",
  "human_review_required",
  "do_not_contact",
  "blocked",
  "completed",
] as const;
export type ChannelState = (typeof CHANNEL_STATES)[number];

/** Allowed pipeline moves. `closed` is reachable from anywhere; nothing leaves `closed`. */
const CUSTOMER_TRANSITIONS: Record<CustomerPipelineState, readonly CustomerPipelineState[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["whatsapp_handoff", "registered", "closed"],
  whatsapp_handoff: ["registered", "closed"],
  registered: ["active_customer", "closed"],
  active_customer: ["closed"],
  closed: [],
};

const AFFILIATE_TRANSITIONS: Record<AffiliatePipelineState, readonly AffiliatePipelineState[]> = {
  discovered: ["qualified", "closed"],
  qualified: ["contacted", "closed"],
  contacted: ["replied", "closed"],
  replied: ["interested", "closed"],
  interested: ["joined_affiliate_group", "closed"],
  joined_affiliate_group: ["active_affiliate", "closed"],
  active_affiliate: ["generated_customer", "closed"],
  generated_customer: ["closed"],
  closed: [],
};

export function pipelineStatesFor(funnel: Funnel): readonly PipelineState[] {
  return funnel === "customers" ? CUSTOMER_PIPELINE : AFFILIATE_PIPELINE;
}

export function canMovePipeline(funnel: Funnel, from: PipelineState, to: PipelineState): boolean {
  if (from === to) return true;
  if (funnel === "customers") {
    const allowed = CUSTOMER_TRANSITIONS[from as CustomerPipelineState];
    return allowed !== undefined && allowed.includes(to as CustomerPipelineState);
  }
  const allowed = AFFILIATE_TRANSITIONS[from as AffiliatePipelineState];
  return allowed !== undefined && allowed.includes(to as AffiliatePipelineState);
}

/** Channel moves. Terminal states (`do_not_contact`, `blocked`, `completed`) never leave. */
const CHANNEL_TRANSITIONS: Record<ChannelState, readonly ChannelState[]> = {
  browser_contact_pending: ["browser_contact_sent", "human_review_required", "do_not_contact", "blocked", "completed"],
  browser_contact_sent: ["waiting_inbound_reply", "human_review_required", "do_not_contact", "blocked", "completed"],
  waiting_inbound_reply: ["api_eligible", "api_active", "human_review_required", "do_not_contact", "blocked", "completed"],
  api_eligible: ["api_active", "api_window_closed", "human_review_required", "do_not_contact", "blocked", "completed"],
  api_active: ["api_window_closed", "human_review_required", "do_not_contact", "blocked", "completed"],
  api_window_closed: ["api_active", "human_review_required", "do_not_contact", "blocked", "completed"],
  human_review_required: ["api_active", "api_eligible", "waiting_inbound_reply", "do_not_contact", "blocked", "completed"],
  do_not_contact: [],
  blocked: [],
  completed: [],
};

export function canMoveChannel(from: ChannelState, to: ChannelState): boolean {
  if (from === to) return true;
  return CHANNEL_TRANSITIONS[from].includes(to);
}

export function isTerminalChannel(state: ChannelState): boolean {
  return CHANNEL_TRANSITIONS[state].length === 0;
}

/** Who may send on this channel state. Exactly one owner, or none. */
export function channelOwner(state: ChannelState): "browser" | "api" | "none" {
  switch (state) {
    case "browser_contact_pending":
      return "browser";
    case "api_eligible":
    case "api_active":
      return "api";
    default:
      return "none";
  }
}
