import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/client";
import { pullRelayEvents } from "@/integrations/instagram/relay";
import { ingestWebhookBody } from "@/integrations/instagram/inbox";
import { listJobs } from "@/db/queries/jobs";
import { getSetting } from "@/db/queries/settings";

const body = (mid: string) =>
  JSON.stringify({ object: "instagram", entry: [{ id: "page", time: 1, messaging: [{ sender: { id: "123" }, recipient: { id: "page" }, timestamp: 1760270000000, message: { mid, text: "oi" } }] }] });

describe("webhook ingestion", () => {
  it("stores a body once and queues one job per message", () => {
    const db = openTestDatabase();
    expect(ingestWebhookBody(db, body("m1"), "route")).toEqual({ duplicate: false, messages: 1, queued: 1 });
    expect(ingestWebhookBody(db, body("m1"), "route")).toEqual({ duplicate: true, messages: 0, queued: 0 });
    expect(listJobs(db).filter((j) => j.type === "process_inbound")).toHaveLength(1);
  });
  it("skips our own echoes and the business account's own messages", () => {
    const db = openTestDatabase();
    const echo = JSON.stringify({ object: "instagram", entry: [{ messaging: [{ sender: { id: "biz" }, recipient: { id: "123" }, message: { mid: "e1", text: "x", is_echo: true } }] }] });
    expect(ingestWebhookBody(db, echo, "relay", "biz").queued).toBe(0);
  });
});

describe("relay pull", () => {
  it("pulls in order, advances the cursor and never re-processes", async () => {
    const db = openTestDatabase();
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const after = Number(new URL(url).searchParams.get("after"));
      const all = [
        { id: 1, receivedAt: "t", body: body("r1") },
        { id: 2, receivedAt: "t", body: body("r2") },
      ];
      return new Response(JSON.stringify({ events: all.filter((e) => e.id > after), last: 2 }), { status: 200 });
    };
    const first = await pullRelayEvents(db, { url: "https://inbox.example", token: "t", fetchImpl });
    expect(first).toEqual({ pulled: 2, queued: 2, last: 2 });
    expect(getSetting<number>(db, "relay.lastEventId", 0)).toBe(2);
    const second = await pullRelayEvents(db, { url: "https://inbox.example", token: "t", fetchImpl });
    expect(second.pulled).toBe(0);
    expect(calls[1]).toContain("after=2");
    expect(listJobs(db).filter((j) => j.type === "process_inbound")).toHaveLength(2);
  });
  it("sends the bearer token and fails loudly on 401", async () => {
    const db = openTestDatabase();
    let auth = "";
    const fetchImpl: typeof fetch = async (_input, init) => {
      auth = String((init?.headers as Record<string, string>).authorization);
      return new Response("unauthorized", { status: 401 });
    };
    await expect(pullRelayEvents(db, { url: "https://inbox.example", token: "secret", fetchImpl })).rejects.toThrow("401");
    expect(auth).toBe("Bearer secret");
  });
});
