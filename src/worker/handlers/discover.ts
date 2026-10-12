import { parsePayload, enqueue } from "@/db/queries/jobs";
import { upsertDiscoveredLead } from "@/db/queries/leads";
import { audit } from "@/db/queries/events";
import { withBrowserLock } from "@/integrations/browser/lock";
import { BrowserUnavailableError, InstagramRestrictionError } from "@/integrations/browser/types";
import type { Funnel } from "@/features/leads/states";
import { addSeconds } from "@/lib/time";
import { isBrowserPaused, pauseBrowser, tripOnRestriction } from "../safety";
import { done, postpone, type JobHandler } from "./types";

export type DiscoverPayload = { funnel: Funnel; query: string; limit: number };

/** Finds candidate profiles for a query and registers them once. Enrichment and scoring are separate jobs. */
export const discoverProfiles: JobHandler = async (job, ctx) => {
  const payload = parsePayload<DiscoverPayload>(job);
  if (isBrowserPaused(ctx.db)) return postpone(addSeconds(ctx.now(), 15 * 60), "browser queue paused");
  try {
    const candidates = await withBrowserLock(async () => {
      const browser = ctx.browser();
      await browser.connect();
      if (!(await browser.isLoggedIn())) throw new InstagramRestrictionError("operator session is not logged in");
      return browser.searchProfiles(payload.query, payload.limit, job.id);
    });
    // An empty grid is almost always Instagram being slow, not a term without posts: try the query once more later.
    if (candidates.length === 0) {
      const alreadyRetried = job.idempotencyKey?.endsWith(":retry") ?? false;
      const queued = alreadyRetried ? null : enqueue(ctx.db, "discover_profiles", payload, { idempotencyKey: `${job.idempotencyKey ?? `discover:${payload.query}`}:retry`, runAt: addSeconds(ctx.now(), 30 * 60), maxAttempts: 2 });
      audit(ctx.db, "worker", "discovery_empty", payload.query, { retryQueued: Boolean(queued) });
      return done(queued ? "no posts in the grid; one retry queued for 30 min from now" : "no posts in the grid");
    }
    let created = 0;
    let duplicates = 0;
    let refused = 0;
    for (const candidate of candidates) {
      const result = upsertDiscoveredLead(ctx.db, payload.funnel, {
        username: candidate.username,
        fullName: candidate.fullName ?? null,
        source: "search",
        sourceDetail: candidate.sourceDetail,
      });
      if (result.status === "created") {
        created += 1;
        enqueue(ctx.db, "enrich_and_score", { leadId: result.lead.id }, { idempotencyKey: `enrich:${result.lead.id}`, leadId: result.lead.id });
      } else if (result.status === "duplicate") duplicates += 1;
      else refused += 1;
    }
    audit(ctx.db, "worker", "discovery_run", payload.query, { candidates: candidates.length, created, duplicates, refused });
    return done(`${created} new, ${duplicates} known, ${refused} refused`);
  } catch (error: unknown) {
    if (error instanceof BrowserUnavailableError) {
      pauseBrowser(ctx.db, error.message);
      return postpone(addSeconds(ctx.now(), 15 * 60), error.message);
    }
    if (error instanceof InstagramRestrictionError) {
      tripOnRestriction(ctx.db, `${error.message}${error.detail ? ` — ${error.detail}` : ""}`);
      return postpone(addSeconds(ctx.now(), 60 * 60), error.message);
    }
    throw error;
  }
};
