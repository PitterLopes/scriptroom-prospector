export const INTENTS = [
  "interested",
  "asked_info",
  "asked_pricing",
  "wants_whatsapp",
  "not_the_owner",
  "will_forward",
  "objection",
  "not_interested",
  "opt_out",
  "ambiguous",
  "needs_human",
] as const;
export type Intent = (typeof INTENTS)[number];

export const ACTIONS = [
  "reply",
  "ask",
  "present",
  "handle_objection",
  "send_store_link",
  "send_whatsapp_link",
  "wait",
  "schedule_follow_up",
  "close",
  "escalate_to_human",
] as const;
export type ConversationAction = (typeof ACTIONS)[number];

/** Intents that end the conversation for good; opt-out also writes the do-not-contact list. */
export const TERMINAL_INTENTS: readonly Intent[] = ["opt_out", "not_interested"];

/** Code-level fallback when the model's action does not fit the intent. */
export function defaultActionFor(intent: Intent): ConversationAction {
  switch (intent) {
    case "interested":
      return "present";
    case "asked_info":
      return "reply";
    case "asked_pricing":
      return "reply";
    case "wants_whatsapp":
      return "send_whatsapp_link";
    case "not_the_owner":
    case "will_forward":
      return "ask";
    case "objection":
      return "handle_objection";
    case "not_interested":
      return "close";
    case "opt_out":
      return "close";
    case "ambiguous":
      return "ask";
    case "needs_human":
      return "escalate_to_human";
  }
}

/** One follow-up, and only one: the test is quick, so silence after it means the app did not make sense (decided 2026-10-12). */
export const MAX_FOLLOW_UPS = 1;
export const FOLLOW_UP_DELAY_HOURS = [48, 96] as const;
