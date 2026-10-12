import { backupDatabase } from "@/db/backup";
import { resolveDatabasePath } from "@/db/client";
import { audit } from "@/db/queries/events";
import { listExperiments, reviewAndAdjust } from "@/features/experiments/queries";
import { done, type JobHandler } from "./types";

export const dailyBackup: JobHandler = async (_job, ctx) => {
  if (resolveDatabasePath(ctx.env.DATABASE_URL) === ":memory:") return done("skipped: in-memory database");
  const target = await backupDatabase({ databaseUrl: ctx.env.DATABASE_URL, backupDir: ctx.env.BACKUP_DIR, now: ctx.now() });
  audit(ctx.db, "worker", "backup_written", target);
  return done(target);
};

export const reviewExperiments: JobHandler = async (_job, ctx) => {
  const notes: string[] = [];
  for (const experiment of listExperiments(ctx.db).filter((e) => e.status === "running")) {
    notes.push(`${experiment.name}: ${reviewAndAdjust(ctx.db, experiment)}`);
  }
  return done(notes.join(" | ") || "no running experiments");
};
