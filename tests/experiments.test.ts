import { describe, expect, it } from "vitest";
import { pickVariant, reviewExperiment } from "@/features/experiments/assign";
import { assignVariant, ensureOpeningExperiment, listVariants } from "@/features/experiments/queries";
import { openTestDatabase } from "@/db/client";
import { upsertDiscoveredLead } from "@/db/queries/leads";

const variants = [
  { id: "control", weight: 1, isControl: true },
  { id: "b", weight: 1, isControl: false },
  { id: "c", weight: 1, isControl: false },
];

describe("pickVariant", () => {
  it("explores challengers for the exploration share", () => {
    let rolls = [0.1, 0.9];
    const picked = pickVariant(variants, 0.2, () => rolls.shift() ?? 0.5);
    expect(picked.id).toBe("c");
    rolls = [0.1, 0.1];
    expect(pickVariant(variants, 0.2, () => rolls.shift() ?? 0.5).id).toBe("b");
  });
  it("follows weights otherwise", () => {
    const rolls = [0.9, 0.05];
    expect(pickVariant(variants, 0.2, () => rolls.shift() ?? 0.5).id).toBe("control");
  });
});

describe("reviewExperiment", () => {
  it("keeps collecting under the minimum sample", () => {
    const outcome = reviewExperiment([{ variantId: "control", sent: 10, replied: 1, interested: 0, isControl: true }, { variantId: "b", sent: 40, replied: 20, interested: 2, isControl: false }], 30);
    expect(outcome.decision).toBe("keep_collecting");
  });
  it("shifts weight gradually when a challenger leads by 5 points", () => {
    const outcome = reviewExperiment([{ variantId: "control", sent: 40, replied: 4, interested: 0, isControl: true }, { variantId: "b", sent: 40, replied: 10, interested: 2, isControl: false }], 30);
    expect(outcome.decision).toBe("shift_weight");
    if (outcome.decision === "shift_weight") {
      expect(outcome.leaderId).toBe("b");
      expect(outcome.weights.b).toBe(2);
      expect(outcome.weights.control).toBe(1);
    }
  });
  it("never crowns the control or a marginal lead", () => {
    const outcome = reviewExperiment([{ variantId: "control", sent: 40, replied: 10, interested: 0, isControl: true }, { variantId: "b", sent: 40, replied: 11, interested: 2, isControl: false }], 30);
    expect(outcome.decision).toBe("keep_collecting");
  });
});

describe("assignment is sticky per lead", () => {
  it("returns the same variant twice", () => {
    const db = openTestDatabase();
    const exp = ensureOpeningExperiment(db);
    expect(listVariants(db, exp.id)).toHaveLength(3);
    const lead = upsertDiscoveredLead(db, "customers", { username: "someone", source: "manual" });
    if (lead.status !== "created") throw new Error("expected created");
    const first = assignVariant(db, exp, lead.lead.id, () => 0.95);
    const second = assignVariant(db, exp, lead.lead.id, () => 0.05);
    expect(second.id).toBe(first.id);
  });
});
