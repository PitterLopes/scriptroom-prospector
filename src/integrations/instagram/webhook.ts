import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta signs the raw body with the app secret: `X-Hub-Signature-256: sha256=<hex>`. */
export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export type InboundMessage = {
  mid: string;
  senderId: string;
  recipientId: string;
  timestamp: string;
  text: string | null;
  attachments: number;
  isEcho: boolean;
};

type MetaMessagingEntry = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number | string;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
  read?: unknown;
  reaction?: unknown;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: MetaMessagingEntry[];
    /** Instagram Login apps deliver the same event as a `changes` item with `field: "messages"`. */
    changes?: Array<{ field?: string; value?: MetaMessagingEntry }>;
  }>;
};

/**
 * Extracts the inbound text messages from either delivery shape (`entry[].messaging[]` or
 * `entry[].changes[].value` with field "messages"). Echoes (our own sends), reads and reactions are reported but not messages.
 */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const data = payload as MetaWebhookPayload;
  if (!data || (data.object !== "instagram" && data.object !== "page")) return [];
  const out: InboundMessage[] = [];
  for (const entry of data.entry ?? []) {
    const items = [...(entry.messaging ?? []), ...(entry.changes ?? []).filter((c) => c.field === "messages" && c.value).map((c) => c.value!)];
    for (const item of items) {
      const message = item.message;
      if (!message || !message.mid || !item.sender?.id) continue;
      out.push({
        mid: message.mid,
        senderId: item.sender.id,
        recipientId: item.recipient?.id ?? "",
        timestamp: new Date(normalizeTimestamp(item.timestamp)).toISOString(),
        text: message.text ?? null,
        attachments: message.attachments?.length ?? 0,
        isEcho: Boolean(message.is_echo),
      });
    }
  }
  return out;
}

/** Meta sends milliseconds in `messaging[]` and sometimes seconds (as a string) in `changes[].value`. */
function normalizeTimestamp(raw: number | string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}

export function verifySubscription(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}
