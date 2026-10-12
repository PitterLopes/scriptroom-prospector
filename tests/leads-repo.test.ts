import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/client";
import { addDoNotContact, getLead, insertMessage, markDoNotContact, moveChannel, movePipeline, TransitionError, upsertDiscoveredLead } from "@/db/queries/leads";
import { listLeadEvents } from "@/db/queries/events";

describe("lead repository", () => {
  it("never duplicates a username, in any spelling", () => {
    const db = openTestDatabase();
    const a = upsertDiscoveredLead(db, "customers", { username: "@Dra.Ana", source: "search", sourceDetail: "#dentista" });
    const b = upsertDiscoveredLead(db, "customers", { username: "dra.ana", source: "search", sourceDetail: "#odontologia", bio: "nova bio" });
    expect(a.status).toBe("created");
    expect(b.status).toBe("duplicate");
    if (a.status === "created" && b.status === "duplicate") {
      expect(b.lead.id).toBe(a.lead.id);
      expect(b.lead.bio).toBe("nova bio");
    }
  });

  it("refuses do-not-contact handles at discovery and after", () => {
    const db = openTestDatabase();
    addDoNotContact(db, "nunca.mais", "pediu");
    expect(upsertDiscoveredLead(db, "customers", { username: "nunca.mais", source: "search" }).status).toBe("do_not_contact");
    const created = upsertDiscoveredLead(db, "customers", { username: "alguem", source: "manual" });
    if (created.status !== "created") throw new Error();
    const dnc = markDoNotContact(db, created.lead, "pediu para parar", "ai");
    expect(dnc.channelState).toBe("do_not_contact");
    expect(dnc.pipelineState).toBe("closed");
    expect(upsertDiscoveredLead(db, "affiliates", { username: "alguem", source: "search" }).status).toBe("do_not_contact");
  });

  it("validates transitions and records events", () => {
    const db = openTestDatabase();
    const created = upsertDiscoveredLead(db, "customers", { username: "fulano", source: "manual" });
    if (created.status !== "created") throw new Error();
    expect(() => movePipeline(db, created.lead, "contacted", "worker")).toThrow(TransitionError);
    const qualified = movePipeline(db, created.lead, "qualified", "worker", "score 70");
    const contacted = movePipeline(db, qualified, "contacted", "browser");
    expect(contacted.contactedAt).not.toBeNull();
    expect(() => moveChannel(db, contacted, "api_active", "worker")).toThrow(TransitionError);
    const types = listLeadEvents(db, created.lead.id).map((e) => e.type);
    expect(types).toContain("discovered");
    expect(types.filter((t) => t === "pipeline_changed")).toHaveLength(2);
  });

  it("blocks a second message with the same dedupe key or external id", () => {
    const db = openTestDatabase();
    const created = upsertDiscoveredLead(db, "customers", { username: "fulano", source: "manual" });
    if (created.status !== "created") throw new Error();
    const first = insertMessage(db, { leadId: created.lead.id, direction: "outbound", channel: "browser", text: "oi", status: "planned", dedupeKey: "first_dm:x" });
    const second = insertMessage(db, { leadId: created.lead.id, direction: "outbound", channel: "browser", text: "oi de novo", status: "planned", dedupeKey: "first_dm:x" });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    const inbound1 = insertMessage(db, { leadId: created.lead.id, direction: "inbound", channel: "api", text: "olá", status: "received", externalId: "mid_1" });
    const inbound2 = insertMessage(db, { leadId: created.lead.id, direction: "inbound", channel: "api", text: "olá", status: "received", externalId: "mid_1" });
    expect(inbound1).not.toBeNull();
    expect(inbound2).toBeNull();
    expect(getLead(db, created.lead.id)).not.toBeNull();
  });
});
