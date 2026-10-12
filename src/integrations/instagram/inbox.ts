import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { enqueue } from "@/db/queries/jobs";
import { audit } from "@/db/queries/events";
import { parseInboundMessages } from "./webhook";
import { sha256Hex } from "@/lib/ids";
import { nowIso } from "@/lib/time";

export type IngestResult = { duplicate: boolean; messages: number; queued: number };

/**
 * One path for every webhook body, whether it arrived at the local route or was pulled from the Cloudflare inbox:
 * record it once (by hash), then one `process_inbound` job per message. Echoes of our own sends are skipped.
 */
export function ingestWebhookBody(db: Db, raw: string, source: "route" | "relay", ownAccountId?: string): IngestResult {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { duplicate: false, messages: 0, queued: 0 };
  }
  const eventId = sha256Hex(raw);
  const stored = db.insert(webhookEvents).values({ id: eventId, payload: raw, receivedAt: nowIso() }).onConflictDoNothing().run();
  if (stored.changes === 0) return { duplicate: true, messages: 0, queued: 0 };
  const messages = parseInboundMessages(payload);
  let queued = 0;
  for (const message of messages) {
    if (message.isEcho) continue;
    if (ownAccountId && message.senderId === ownAccountId) continue;
    const id = enqueue(
      db,
      "process_inbound",
      { mid: message.mid, senderId: message.senderId, recipientId: message.recipientId, text: message.text, timestamp: message.timestamp, attachments: message.attachments },
      { idempotencyKey: `inbound:${message.mid}`, maxAttempts: 4 },
    );
    if (id) queued += 1;
  }
  db.update(webhookEvents).set({ processedAt: nowIso() }).where(eq(webhookEvents.id, eventId)).run();
  audit(db, "webhook", "webhook_received", eventId.slice(0, 12), { source, messages: messages.length, queued });
  return { duplicate: false, messages: messages.length, queued };
}
