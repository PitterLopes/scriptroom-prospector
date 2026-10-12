import { describe, expect, it } from "vitest";
import { canMoveChannel, canMovePipeline, channelOwner, isTerminalChannel } from "@/features/leads/states";

describe("pipeline transitions", () => {
  it("follows the customer funnel in order", () => {
    expect(canMovePipeline("customers", "discovered", "qualified")).toBe(true);
    expect(canMovePipeline("customers", "qualified", "contacted")).toBe(true);
    expect(canMovePipeline("customers", "contacted", "replied")).toBe(true);
    expect(canMovePipeline("customers", "replied", "interested")).toBe(true);
    expect(canMovePipeline("customers", "interested", "registered")).toBe(true);
  });
  it("refuses skipping and refuses leaving closed", () => {
    expect(canMovePipeline("customers", "discovered", "contacted")).toBe(false);
    expect(canMovePipeline("customers", "closed", "qualified")).toBe(false);
    expect(canMovePipeline("affiliates", "interested", "whatsapp_handoff")).toBe(false);
  });
  it("closes from anywhere", () => {
    expect(canMovePipeline("customers", "discovered", "closed")).toBe(true);
    expect(canMovePipeline("affiliates", "active_affiliate", "closed")).toBe(true);
  });
});

describe("channel transitions", () => {
  it("hands off browser → api and never back", () => {
    expect(canMoveChannel("waiting_inbound_reply", "api_eligible")).toBe(true);
    expect(canMoveChannel("api_eligible", "api_active")).toBe(true);
    expect(canMoveChannel("api_active", "browser_contact_pending")).toBe(false);
    expect(canMoveChannel("api_window_closed", "browser_contact_sent")).toBe(false);
  });
  it("terminal states are terminal", () => {
    expect(isTerminalChannel("do_not_contact")).toBe(true);
    expect(canMoveChannel("do_not_contact", "api_active")).toBe(false);
    expect(canMoveChannel("blocked", "completed")).toBe(false);
  });
  it("exactly one owner per state", () => {
    expect(channelOwner("browser_contact_pending")).toBe("browser");
    expect(channelOwner("api_active")).toBe("api");
    expect(channelOwner("waiting_inbound_reply")).toBe("none");
    expect(channelOwner("human_review_required")).toBe("none");
  });
});
