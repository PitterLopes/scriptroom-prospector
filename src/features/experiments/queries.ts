import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { experimentAssignments, experimentVariants, experiments, leads, messages, type Experiment, type ExperimentVariant } from "@/db/schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import type { Funnel } from "@/features/leads/states";
import type { OpeningVariantConfig } from "@/integrations/openrouter/prompts";
import { pickVariant, reviewExperiment, type VariantStats } from "./assign";
import { audit } from "@/db/queries/events";

export const OPENING_EXPERIMENT = "opening_style_honest";
const RETIRED_EXPERIMENTS = ["opening_style"];

const DEFAULT_OPENING_VARIANTS: Array<{ name: string; isControl: boolean; config: OpeningVariantConfig }> = [
  { name: "Honesta, pedido completo", isControl: true, config: { style: "honest_ask" } },
  { name: "Honesta, curta", isControl: false, config: { style: "honest_short" } },
  { name: "Honesta, de colega", isControl: false, config: { style: "honest_peer" } },
];

/** The first experiment ships with the system: three opening styles, one variable, control included. */
export function ensureOpeningExperiment(db: Db, funnel: Funnel = "customers"): Experiment {
  for (const retired of RETIRED_EXPERIMENTS) {
    db.update(experiments)
      .set({ status: "concluded", concludedAt: nowIso(), updatedAt: nowIso() })
      .where(and(eq(experiments.variable, retired), eq(experiments.status, "running")))
      .run();
  }
  const existing = db
    .select()
    .from(experiments)
    .where(and(eq(experiments.variable, OPENING_EXPERIMENT), eq(experiments.funnel, funnel), eq(experiments.status, "running")))
    .get();
  if (existing) return existing;
  const now = nowIso();
  const id = newId();
  db.insert(experiments)
    .values({ id, name: "Primeira mensagem honesta: como pedir", variable: OPENING_EXPERIMENT, funnel, status: "running", explorationShare: 0.2, minSampleSize: 30, createdAt: now, updatedAt: now })
    .run();
  for (const v of DEFAULT_OPENING_VARIANTS) {
    db.insert(experimentVariants)
      .values({ id: newId(), experimentId: id, name: v.name, isControl: v.isControl, weight: 1, config: JSON.stringify(v.config), createdAt: now })
      .run();
  }
  return db.select().from(experiments).where(eq(experiments.id, id)).get()!;
}

export function listExperiments(db: Db): Experiment[] {
  return db.select().from(experiments).all();
}

export function listVariants(db: Db, experimentId: string): ExperimentVariant[] {
  return db.select().from(experimentVariants).where(eq(experimentVariants.experimentId, experimentId)).all();
}

/** Idempotent per lead: the same lead always gets the same variant. */
export function assignVariant(db: Db, experiment: Experiment, leadId: string, random: () => number = Math.random): ExperimentVariant {
  const existing = db
    .select({ variantId: experimentAssignments.variantId })
    .from(experimentAssignments)
    .where(and(eq(experimentAssignments.experimentId, experiment.id), eq(experimentAssignments.leadId, leadId)))
    .get();
  const variants = listVariants(db, experiment.id);
  if (existing) return variants.find((v) => v.id === existing.variantId)!;
  const picked = pickVariant(variants, experiment.explorationShare, random);
  db.insert(experimentAssignments)
    .values({ id: newId(), experimentId: experiment.id, variantId: picked.id, leadId, createdAt: nowIso() })
    .onConflictDoNothing()
    .run();
  return picked;
}

export function variantConfig(variant: ExperimentVariant): OpeningVariantConfig {
  return JSON.parse(variant.config) as OpeningVariantConfig;
}

/** Sent = first DMs actually sent with the variant; replied = the lead has an inbound message; interested = pipeline past replied. */
export function variantStats(db: Db, experimentId: string): VariantStats[] {
  const variants = listVariants(db, experimentId);
  return variants.map((v) => {
    const sent = db
      .select({ count: sql<number>`count(distinct ${messages.leadId})` })
      .from(messages)
      .where(and(eq(messages.variantId, v.id), eq(messages.status, "sent"), eq(messages.direction, "outbound")))
      .get()?.count ?? 0;
    const replied = db
      .select({ count: sql<number>`count(distinct ${leads.id})` })
      .from(leads)
      .innerJoin(messages, and(eq(messages.leadId, leads.id), eq(messages.variantId, v.id), eq(messages.status, "sent")))
      .where(sql`${leads.repliedAt} is not null`)
      .get()?.count ?? 0;
    const interested = db
      .select({ count: sql<number>`count(distinct ${leads.id})` })
      .from(leads)
      .innerJoin(messages, and(eq(messages.leadId, leads.id), eq(messages.variantId, v.id), eq(messages.status, "sent")))
      .where(sql`${leads.pipelineState} in ('interested','whatsapp_handoff','registered','active_customer')`)
      .get()?.count ?? 0;
    return { variantId: v.id, sent, replied, interested, isControl: v.isControl };
  });
}

/** Runs the conservative review and, when it decides, shifts weights gradually. Never concludes on its own. */
export function reviewAndAdjust(db: Db, experiment: Experiment): string {
  const stats = variantStats(db, experiment.id);
  const outcome = reviewExperiment(stats, experiment.minSampleSize);
  if (outcome.decision === "shift_weight") {
    for (const [variantId, weight] of Object.entries(outcome.weights)) {
      db.update(experimentVariants).set({ weight }).where(eq(experimentVariants.id, variantId)).run();
    }
    db.update(experiments).set({ updatedAt: nowIso() }).where(eq(experiments.id, experiment.id)).run();
    audit(db, "ai", "experiment_weights_shifted", experiment.id, { leaderId: outcome.leaderId, weights: outcome.weights, reason: outcome.reason });
  }
  return outcome.reason;
}

export function setExperimentStatus(db: Db, experimentId: string, status: "running" | "paused" | "concluded", winnerVariantId?: string | null): void {
  db.update(experiments)
    .set({ status, winnerVariantId: winnerVariantId ?? null, concludedAt: status === "concluded" ? nowIso() : null, updatedAt: nowIso() })
    .where(eq(experiments.id, experimentId))
    .run();
}
