import { countJobsDoneSince, parsePayload } from "@/db/queries/jobs";
import { getLead, movePipeline, moveChannel, updateLeadFields } from "@/db/queries/leads";
import { recordLeadEvent } from "@/db/queries/events";
import { withBrowserLock } from "@/integrations/browser/lock";
import { BrowserUnavailableError, InstagramRestrictionError } from "@/integrations/browser/types";
import { bestSendWindow, scoreProfile } from "@/features/leads/scoring";
import { addSeconds, startOfDayInZone } from "@/lib/time";
import { isBrowserPaused, pauseBrowser, tripOnRestriction } from "../safety";
import { done, postpone, type JobHandler } from "./types";

/** Reads the public profile, scores it in code and qualifies or closes the lead. */
export const enrichAndScore: JobHandler = async (job, ctx) => {
  const { leadId } = parsePayload<{ leadId: string }>(job);
  const lead = getLead(ctx.db, leadId);
  if (!lead) return done("lead no longer exists");
  if (lead.pipelineState !== "discovered") return done("already processed");
  if (isBrowserPaused(ctx.db)) return postpone(addSeconds(ctx.now(), 15 * 60), "browser queue paused");
  const doneToday = countJobsDoneSince(ctx.db, "enrich_and_score", startOfDayInZone(ctx.now(), ctx.env.OPERATING_TIMEZONE).toISOString());
  if (doneToday >= ctx.env.ENRICH_PER_DAY) return postpone(addSeconds(ctx.now(), 4 * 3600), `enrich cap for today reached (${doneToday})`);
  try {
    const profile = await withBrowserLock(async () => {
      const browser = ctx.browser();
      await browser.connect();
      return browser.readProfile(lead.username, job.id);
    });
    if (!profile.exists) {
      moveChannel(ctx.db, lead, "completed", "worker", "profile does not exist");
      movePipeline(ctx.db, getLead(ctx.db, leadId)!, "closed", "worker", "profile does not exist");
      return done("profile missing");
    }
    updateLeadFields(ctx.db, leadId, {
      fullName: profile.fullName ?? lead.fullName,
      bio: profile.bio ?? lead.bio,
      category: profile.category ?? lead.category,
      followers: profile.followers ?? lead.followers,
      following: profile.following ?? lead.following,
      posts: profile.posts ?? lead.posts,
      isBusiness: profile.isBusiness ?? lead.isBusiness,
      externalUrl: profile.externalUrl ?? lead.externalUrl,
      location: profile.location ?? lead.location,
      recentPostsSummary: profile.recentPostsSummary ?? lead.recentPostsSummary,
      recentPosts: profile.recentPosts ? JSON.stringify(profile.recentPosts) : lead.recentPosts,
      lastPublicPostAt: profile.lastPublicPostAt ?? lead.lastPublicPostAt,
    });
    const refreshed = getLead(ctx.db, leadId)!;
    const mentionsUs = new RegExp(ctx.config.company.name, "i").test(`${refreshed.bio ?? ""} ${refreshed.externalUrl ?? ""}`);
    const score = scoreProfile({ ...refreshed, recentPosts: JSON.parse(refreshed.recentPosts) as Array<{ caption: string; postedAt: string | null; kind: "post" | "reel" }> }, ctx.config);
    updateLeadFields(ctx.db, leadId, {
      icpScore: score.score,
      icpReasons: JSON.stringify(score.reasons),
      segment: score.segment,
      roleGuess: score.roleGuess,
      priority: score.priority,
      bestSendWindow: bestSendWindow(refreshed.lastPublicPostAt, ctx.env.OPERATING_TIMEZONE),
    });
    recordLeadEvent(ctx.db, leadId, "scored", "worker", { score: score.score, reasons: score.reasons, roleGuess: score.roleGuess, segment: score.segment, private: profile.isPrivate, mentionsUs });
    const current = getLead(ctx.db, leadId)!;
    if (mentionsUs) {
      moveChannel(ctx.db, current, "completed", "worker", "already a user");
      movePipeline(ctx.db, getLead(ctx.db, leadId)!, "closed", "worker", "already mentions the product");
      return done("already a user");
    }
    if (profile.isPrivate) {
      moveChannel(ctx.db, current, "completed", "worker", "private profile");
      movePipeline(ctx.db, getLead(ctx.db, leadId)!, "closed", "worker", "private profile: not enough public signal");
      return done("private profile");
    }
    if (score.qualified) {
      movePipeline(ctx.db, current, "qualified", "worker", `score ${score.score}`);
      return done(`qualified with ${score.score}`);
    }
    moveChannel(ctx.db, current, "completed", "worker", "below ICP threshold");
    movePipeline(ctx.db, getLead(ctx.db, leadId)!, "closed", "worker", `score ${score.score} below threshold`);
    return done(`closed with ${score.score}`);
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
