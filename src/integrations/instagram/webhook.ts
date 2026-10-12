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
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] };
  read?: unknown;
  reaction?: unknown;
};

type MetaWebhookPayload = {
  object?: string;
  entry?: Array<{ id?: string; time?: number; messaging?: MetaMessagingEntry[] }>;
};

/** Extracts the inbound text messages. Echoes (our own sends), reads and reactions are reported but not messages. */
export function parseInboundMessages(payload: unknown): InboundMessage[] {
  const data = payload as MetaWebhookPayload;
  if (!data || (data.object !== "instagram" && data.object !== "page")) return [];
  const out: InboundMessage[] = [];
  for (const entry of data.entry ?? []) {
    for (const item of entry.messaging ?? []) {
      const message = item.message;
      if (!message || !message.mid || !item.sender?.id) continue;
      out.push({
        mid: message.mid,
        senderId: item.sender.id,
        recipientId: item.recipient?.id ?? "",
        timestamp: new Date(item.timestamp ?? Date.now()).toISOString(),
        text: message.text ?? null,
        attachments: message.attachments?.length ?? 0,
        isEcho: Boolean(message.is_echo),
      });
    }
  }
  return out;
}

export function verifySubscription(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  if (params.get("hub.verify_token") !== verifyToken) return null;
  return params.get("hub.challenge");
}
