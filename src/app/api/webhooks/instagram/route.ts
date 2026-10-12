import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { webhookEvents } from "@/db/schema";
import { enqueue } from "@/db/queries/jobs";
import { audit } from "@/db/queries/events";
import { parseInboundMessages, verifySubscription, verifyWebhookSignature } from "@/integrations/instagram/webhook";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { sha256Hex } from "@/lib/ids";
import { nowIso } from "@/lib/time";

const log = logger("webhook");

export const dynamic = "force-dynamic";

/** Meta's subscription handshake. */
export async function GET(request: Request): Promise<Response> {
  const e = env();
  if (!e.INSTAGRAM_WEBHOOK_VERIFY_TOKEN) return new NextResponse("webhook not configured", { status: 503 });
  const challenge = verifySubscription(new URL(request.url).searchParams, e.INSTAGRAM_WEBHOOK_VERIFY_TOKEN);
  if (!challenge) return new NextResponse("forbidden", { status: 403 });
  return new NextResponse(challenge, { status: 200 });
}

/**
 * Receives messaging events. Signature first, then an idempotent record of the raw event, then one
 * `process_inbound` job per message. The route never talks to Instagram or to the model: the worker does.
 */
export async function POST(request: Request): Promise<Response> {
  const e = env();
  if (!e.INSTAGRAM_APP_SECRET) return new NextResponse("webhook not configured", { status: 503 });
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, signature, e.INSTAGRAM_APP_SECRET)) {
    log.warn("webhook signature rejected");
    return new NextResponse("invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("invalid json", { status: 400 });
  }
  const db = getDb();
  const eventId = sha256Hex(raw);
  const stored = db.insert(webhookEvents).values({ id: eventId, payload: raw, receivedAt: nowIso() }).onConflictDoNothing().run();
  if (stored.changes === 0) return NextResponse.json({ ok: true, duplicate: true });

  const messages = parseInboundMessages(payload);
  let queued = 0;
  for (const message of messages) {
    if (message.isEcho) continue;
    if (e.INSTAGRAM_BUSINESS_ACCOUNT_ID && message.senderId === e.INSTAGRAM_BUSINESS_ACCOUNT_ID) continue;
    const id = enqueue(
      db,
      "process_inbound",
      { mid: message.mid, senderId: message.senderId, recipientId: message.recipientId, text: message.text, timestamp: message.timestamp, attachments: message.attachments },
      { idempotencyKey: `inbound:${message.mid}`, maxAttempts: 4 },
    );
    if (id) queued += 1;
  }
  db.update(webhookEvents).set({ processedAt: nowIso() }).where(eq(webhookEvents.id, eventId)).run();
  audit(db, "webhook", "webhook_received", eventId.slice(0, 12), { messages: messages.length, queued });
  return NextResponse.json({ ok: true, queued });
}
