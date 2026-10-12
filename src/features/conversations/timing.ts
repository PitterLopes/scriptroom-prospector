/**
 * The follow-up must leave through the API, so it has to fit inside Meta's 24 h window that opens with the person's
 * last message. Whatever the model suggests, the follow-up is due no later than this many hours after that message.
 */
export const FOLLOW_UP_BEFORE_WINDOW_HOURS = 22;

/** After the follow-up, this is how long the person has before silence is read as "the app did not make sense". */
export const CLOSE_AFTER_FOLLOW_UP_HOURS = 24;

export function followUpInstant(now: Date, lastInboundIso: string | null, hours: number): Date {
  const suggested = new Date(now.getTime() + Math.max(hours, 1) * 3600 * 1000);
  if (!lastInboundIso) return suggested;
  const deadline = new Date(new Date(lastInboundIso).getTime() + FOLLOW_UP_BEFORE_WINDOW_HOURS * 3600 * 1000);
  return suggested < deadline ? suggested : deadline;
}
