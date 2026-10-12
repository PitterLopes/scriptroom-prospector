import { loadDotenv } from "@/lib/dotenv";
import { claimNext, completeJob, failJob, postponeJob, recoverStaleJobs, type JobType } from "@/db/queries/jobs";
import { audit } from "@/db/queries/events";
import { createContext, type WorkerContext } from "./context";
import { scheduleTick } from "./scheduler";
import { pullRelaySafely } from "@/integrations/instagram/relay";
import { discoverProfiles } from "./handlers/discover";
import { enrichAndScore } from "./handlers/enrich";
import { sendFirstDm } from "./handlers/first-dm";
import { processInbound } from "./handlers/inbound";
import { sendApiReply } from "./handlers/api-reply";
import { followUp } from "./handlers/follow-up";
import { dailyBackup, reviewExperiments } from "./handlers/maintenance";
import type { JobHandler } from "./handlers/types";

export const HANDLERS: Record<JobType, JobHandler> = {
  discover_profiles: discoverProfiles,
  enrich_and_score: enrichAndScore,
  send_first_dm: sendFirstDm,
  process_inbound: processInbound,
  send_api_reply: sendApiReply,
  follow_up: followUp,
  daily_backup: dailyBackup,
  review_experiments: reviewExperiments,
};

const ALL_TYPES = Object.keys(HANDLERS) as JobType[];

const RELAY_PULL_INTERVAL_MS = 30_000;

/** One pass: recover, schedule, then run due jobs until the queue is empty or `maxJobs` is reached. */
export async function runOnce(ctx: WorkerContext, maxJobs = 20): Promise<{ ran: number; scheduled: number }> {
  recoverStaleJobs(ctx.db, ctx.now());
  if (ctx.env.RELAY_URL && ctx.env.RELAY_TOKEN) {
    await pullRelaySafely(ctx.db, { url: ctx.env.RELAY_URL, token: ctx.env.RELAY_TOKEN, ownAccountId: ctx.env.INSTAGRAM_BUSINESS_ACCOUNT_ID });
  }
  const { scheduled } = scheduleTick(ctx);
  let ran = 0;
  let lastPull = Date.now();
  while (ran < maxJobs) {
    // Re-plan every few jobs so a freshly qualified lead gets its DM scheduled without waiting for the whole pass.
    if (ran > 0 && ran % 3 === 0) scheduleTick(ctx);
    // A browser job can take minutes; a reply that arrived meanwhile should not wait for the whole pass.
    if (ctx.env.RELAY_URL && ctx.env.RELAY_TOKEN && Date.now() - lastPull > RELAY_PULL_INTERVAL_MS) {
      await pullRelaySafely(ctx.db, { url: ctx.env.RELAY_URL, token: ctx.env.RELAY_TOKEN, ownAccountId: ctx.env.INSTAGRAM_BUSINESS_ACCOUNT_ID });
      lastPull = Date.now();
    }
    const job = claimNext(ctx.db, ctx.workerId, ALL_TYPES, ctx.now());
    if (!job) break;
    ran += 1;
    const handler = HANDLERS[job.type as JobType];
    try {
      const result = await handler(job, ctx);
      if (result.kind === "done") {
        completeJob(ctx.db, job.id);
        ctx.log.info("job done", { type: job.type, id: job.id, note: result.note });
      } else if (result.kind === "postpone") {
        postponeJob(ctx.db, job.id, result.runAt, result.note);
        ctx.log.info("job postponed", { type: job.type, id: job.id, runAt: result.runAt.toISOString(), note: result.note });
      } else {
        const outcome = failJob(ctx.db, { ...job }, result.error, ctx.now());
        ctx.log.warn("job failed", { type: job.type, id: job.id, error: result.error, outcome });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const outcome = failJob(ctx.db, { ...job }, message, ctx.now());
      ctx.log.error("job threw", { type: job.type, id: job.id, error: message, outcome });
    }
  }
  return { ran, scheduled };
}

async function main(): Promise<void> {
  loadDotenv();
  const ctx = createContext();
  const once = process.argv.includes("--once");
  // One worker per machine: anything still "running" at startup belongs to a process that is gone.
  const recovered = recoverStaleJobs(ctx.db, ctx.now(), 0);
  if (recovered > 0) ctx.log.info("recovered jobs left running by a previous process", { recovered });
  audit(ctx.db, "worker", "worker_started", ctx.workerId, { once, sendEnabled: ctx.sendEnabled() });
  ctx.log.info("worker started", { workerId: ctx.workerId, once, sendEnabled: ctx.sendEnabled(), browserFlag: ctx.env.BROWSER_SEND_ENABLED });
  let stopping = false;
  const stop = () => {
    stopping = true;
    ctx.log.info("worker stopping");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  do {
    const { ran } = await runOnce(ctx);
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, ran > 0 ? 1500 : 8000));
  } while (!stopping);
  await ctx.browser().close().catch(() => undefined);
  audit(ctx.db, "worker", "worker_stopped", ctx.workerId);
}

if (process.argv[1] && /worker[\\/]index\.ts$/.test(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`worker crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
  });
}
