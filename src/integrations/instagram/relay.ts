import type { Db } from "@/db/client";
import { getSetting, setSetting } from "@/db/queries/settings";
import { raiseException } from "@/db/queries/events";
import { logger } from "@/lib/logger";
import { ingestWebhookBody } from "./inbox";

const log = logger("relay");
const CURSOR_KEY = "relay.lastEventId";

export type RelayEvent = { id: number; receivedAt: string; body: string };

/** Pulls new webhook events from the Cloudflare inbox and feeds them into the same ingestion as the local route. */
export async function pullRelayEvents(
  db: Db,
  options: { url: string; token: string; ownAccountId?: string; fetchImpl?: typeof fetch; limit?: number },
): Promise<{ pulled: number; queued: number; last: number }> {
  const after = getSetting<number>(db, CURSOR_KEY, 0);
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = `${options.url.replace(/\/$/, "")}/events?after=${after}&limit=${options.limit ?? 100}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  let data: { events: RelayEvent[]; last: number };
  try {
    const res = await fetchImpl(endpoint, { headers: { authorization: `Bearer ${options.token}` }, signal: controller.signal });
    if (!res.ok) throw new Error(`inbox answered ${res.status}`);
    data = (await res.json()) as { events: RelayEvent[]; last: number };
  } finally {
    clearTimeout(timer);
  }
  let queued = 0;
  let cursor = after;
  for (const event of data.events) {
    const result = ingestWebhookBody(db, event.body, "relay", options.ownAccountId);
    queued += result.queued;
    cursor = event.id;
  }
  if (cursor !== after) setSetting(db, CURSOR_KEY, cursor);
  if (data.events.length > 0) log.info("relay events pulled", { pulled: data.events.length, queued, cursor });
  return { pulled: data.events.length, queued, last: data.last };
}

/** Called from the worker loop; failures are logged and surfaced once per hour, never fatal. */
export async function pullRelaySafely(db: Db, options: { url: string; token: string; ownAccountId?: string }): Promise<void> {
  try {
    await pullRelayEvents(db, options);
    setSetting(db, "relay.lastOkAt", new Date().toISOString());
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const lastWarned = getSetting<string | null>(db, "relay.lastWarnedAt", null);
    if (!lastWarned || Date.now() - new Date(lastWarned).getTime() > 3600_000) {
      raiseException(db, "relay_unreachable", `Caixa de entrada na Cloudflare indisponível: ${message}`);
      setSetting(db, "relay.lastWarnedAt", new Date().toISOString());
    }
    log.warn("relay pull failed", { error: message });
  }
}
