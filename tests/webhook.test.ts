import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseInboundMessages, verifySubscription, verifyWebhookSignature } from "@/integrations/instagram/webhook";
import { apiWindowExpiry, apiWindowOpen } from "@/integrations/instagram/graph";

const payload = {
  object: "instagram",
  entry: [
    {
      id: "17841400000000000",
      time: 1760270000000,
      messaging: [
        { sender: { id: "123" }, recipient: { id: "17841400000000000" }, timestamp: 1760270000000, message: { mid: "mid_a", text: "Oi! Como funciona?" } },
        { sender: { id: "17841400000000000" }, recipient: { id: "123" }, timestamp: 1760270001000, message: { mid: "mid_echo", text: "eco", is_echo: true } },
        { sender: { id: "123" }, recipient: { id: "17841400000000000" }, timestamp: 1760270002000, read: { watermark: 1 } },
      ],
    },
  ],
};

describe("webhook signature", () => {
  it("accepts the right HMAC and rejects anything else", () => {
    const raw = JSON.stringify(payload);
    const good = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    expect(verifyWebhookSignature(raw, good, "secret")).toBe(true);
    expect(verifyWebhookSignature(raw, good, "other")).toBe(false);
    expect(verifyWebhookSignature(raw, "sha256=00", "secret")).toBe(false);
    expect(verifyWebhookSignature(raw, null, "secret")).toBe(false);
  });
  it("answers the subscription handshake only with the right token", () => {
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "v", "hub.challenge": "42" }), "v")).toBe("42");
    expect(verifySubscription(new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42" }), "v")).toBeNull();
  });
});

describe("webhook parsing", () => {
  it("extracts messages, flags echoes, skips reads", () => {
    const messages = parseInboundMessages(payload);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ mid: "mid_a", senderId: "123", text: "Oi! Como funciona?", isEcho: false });
    expect(messages[1]!.isEcho).toBe(true);
    expect(parseInboundMessages({ object: "whatsapp" })).toEqual([]);
  });
});

describe("messaging window", () => {
  it("is 24 hours from the last inbound", () => {
    const inbound = "2026-10-12T12:00:00.000Z";
    expect(apiWindowExpiry(inbound)).toBe("2026-10-13T12:00:00.000Z");
    expect(apiWindowOpen(apiWindowExpiry(inbound), new Date("2026-10-13T11:59:00Z"))).toBe(true);
    expect(apiWindowOpen(apiWindowExpiry(inbound), new Date("2026-10-13T12:01:00Z"))).toBe(false);
    expect(apiWindowOpen(null)).toBe(false);
  });
});
