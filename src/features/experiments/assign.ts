export type VariantLike = { id: string; weight: number; isControl: boolean };

/**
 * Weighted pick with a guaranteed exploration share and a control group.
 * `explorationShare` of traffic goes uniformly across non-control variants so a new
 * hypothesis always gets samples; the rest follows the weights (which the review job raises for the leader).
 */
export function pickVariant<T extends VariantLike>(variants: readonly T[], explorationShare: number, random: () => number = Math.random): T {
  if (variants.length === 0) throw new Error("No variants to pick from");
  if (variants.length === 1) return variants[0]!;
  const control = variants.find((v) => v.isControl) ?? variants[0]!;
  const roll = random();
  const challengers = variants.filter((v) => v.id !== control.id);
  if (roll < explorationShare && challengers.length > 0) {
    return challengers[Math.floor(random() * challengers.length)]!;
  }
  const total = variants.reduce((sum, v) => sum + Math.max(v.weight, 0), 0);
  if (total <= 0) return control;
  let cursor = random() * total;
  for (const variant of variants) {
    cursor -= Math.max(variant.weight, 0);
    if (cursor <= 0) return variant;
  }
  return variants[variants.length - 1]!;
}

export type VariantStats = { variantId: string; sent: number; replied: number; interested: number; isControl: boolean };

export type ReviewOutcome =
  | { decision: "keep_collecting"; reason: string }
  | { decision: "shift_weight"; leaderId: string; weights: Record<string, number>; reason: string };

/**
 * Conservative review: never declares a winner early. Requires the minimum sample on every variant and a
 * reply-rate lead of at least 5 percentage points over control; then shifts weight gradually (never to 100%).
 */
export function reviewExperiment(stats: readonly VariantStats[], minSampleSize: number): ReviewOutcome {
  if (stats.length < 2) return { decision: "keep_collecting", reason: "fewer than two variants" };
  const underSampled = stats.filter((s) => s.sent < minSampleSize);
  if (underSampled.length > 0) {
    return { decision: "keep_collecting", reason: `${underSampled.length} variant(s) below ${minSampleSize} sends` };
  }
  const control = stats.find((s) => s.isControl) ?? stats[0]!;
  const rate = (s: VariantStats) => (s.sent === 0 ? 0 : s.replied / s.sent);
  const leader = [...stats].sort((a, b) => rate(b) - rate(a))[0]!;
  const lead = rate(leader) - rate(control);
  if (leader.variantId === control.variantId || lead < 0.05) {
    return { decision: "keep_collecting", reason: `no challenger beats control by 5 points (best lead ${(lead * 100).toFixed(1)} pts)` };
  }
  const weights: Record<string, number> = {};
  for (const s of stats) weights[s.variantId] = s.variantId === leader.variantId ? 2 : 1;
  return { decision: "shift_weight", leaderId: leader.variantId, weights, reason: `leader reply rate ${(rate(leader) * 100).toFixed(1)}% vs control ${(rate(control) * 100).toFixed(1)}%` };
}
