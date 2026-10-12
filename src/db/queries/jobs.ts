import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../client";
import { jobs, type Job } from "../schema";
import { newId } from "@/lib/ids";
import { addSeconds, nowIso } from "@/lib/time";
import { raiseException } from "./events";

export const JOB_TYPES = [
  "discover_profiles",
  "enrich_and_score",
  "send_first_dm",
  "process_inbound",
  "send_api_reply",
  "follow_up",
  "daily_backup",
  "review_experiments",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export type EnqueueOptions = {
  runAt?: Date;
  idempotencyKey?: string;
  leadId?: string | null;
  maxAttempts?: number;
};

const STALE_LOCK_SECONDS = 15 * 60;

/** Adds a job. A repeated idempotency key is a no-op and returns null. */
export function enqueue(db: Db, type: JobType, payload: Record<string, unknown>, options: EnqueueOptions = {}): string | null {
  const id = newId();
  const now = nowIso();
  const result = db
    .insert(jobs)
    .values({
      id,
      type,
      payload: JSON.stringify(payload),
      status: "pending",
      runAt: (options.runAt ?? new Date()).toISOString(),
      maxAttempts: options.maxAttempts ?? 5,
      idempotencyKey: options.idempotencyKey ?? null,
      leadId: options.leadId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .run();
  return result.changes === 0 ? null : id;
}

/** Returns running jobs whose lock expired to the pending state (worker crashed mid-job). */
export function recoverStaleJobs(db: Db, now: Date = new Date(), staleAfterSeconds: number = STALE_LOCK_SECONDS): number {
  const cutoff = addSeconds(now, -staleAfterSeconds).toISOString();
  const result = db
    .update(jobs)
    .set({ status: "pending", lockedAt: null, lockedBy: null, updatedAt: now.toISOString() })
    .where(and(eq(jobs.status, "running"), lt(jobs.lockedAt, cutoff)))
    .run();
  return result.changes;
}

/** Conversations first (a lead is waiting), then the day's DMs, then reading profiles, then discovery. */
const PRIORITY: Record<JobType, number> = {
  send_api_reply: 0,
  process_inbound: 0,
  follow_up: 1,
  send_first_dm: 2,
  enrich_and_score: 3,
  discover_profiles: 4,
  daily_backup: 5,
  review_experiments: 5,
};

/** Atomically claims the next due job of the given types, by priority then by due time. SQLite's single writer makes the update-then-read safe. */
export function claimNext(db: Db, workerId: string, types: readonly JobType[], now: Date = new Date()): Job | null {
  if (types.length === 0) return null;
  const nowText = now.toISOString();
  const priorityCase = sql`CASE ${jobs.type} ${sql.join(
    Object.entries(PRIORITY).map(([type, p]) => sql`WHEN ${type} THEN ${p}`),
    sql` `,
  )} ELSE 9 END`;
  const candidate = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, nowText), inArray(jobs.type, [...types])))
    .orderBy(asc(priorityCase), asc(jobs.runAt), asc(jobs.createdAt))
    .limit(1)
    .get();
  if (!candidate) return null;
  const claimed = db
    .update(jobs)
    .set({
      status: "running",
      lockedAt: nowText,
      lockedBy: workerId,
      attempts: sql`${jobs.attempts} + 1`,
      updatedAt: nowText,
    })
    .where(and(eq(jobs.id, candidate.id), eq(jobs.status, "pending")))
    .run();
  if (claimed.changes === 0) return null;
  return db.select().from(jobs).where(eq(jobs.id, candidate.id)).get() ?? null;
}

export function completeJob(db: Db, id: string): void {
  const now = nowIso();
  db.update(jobs).set({ status: "done", finishedAt: now, lockedAt: null, lockedBy: null, updatedAt: now }).where(eq(jobs.id, id)).run();
}

/** Exponential backoff; after the last attempt the job is dead and an exception is opened. */
export function failJob(db: Db, job: Job, error: string, now: Date = new Date()): "retry" | "dead" {
  const dead = job.attempts >= job.maxAttempts;
  const delay = Math.min(30 * 2 ** Math.max(job.attempts - 1, 0), 3600);
  db.update(jobs)
    .set({
      status: dead ? "dead" : "pending",
      lastError: error.slice(0, 2000),
      runAt: dead ? job.runAt : addSeconds(now, delay).toISOString(),
      lockedAt: null,
      lockedBy: null,
      finishedAt: dead ? now.toISOString() : null,
      updatedAt: now.toISOString(),
    })
    .where(eq(jobs.id, job.id))
    .run();
  if (dead) {
    raiseException(db, "job_dead", `Job ${job.type} failed ${job.attempts} times: ${error.slice(0, 300)}`, {
      jobId: job.id,
      leadId: job.leadId,
      payload: { type: job.type, lastError: error.slice(0, 2000) },
    });
  }
  return dead ? "dead" : "retry";
}

/** Postpones a running job without counting the attempt as a failure (e.g. outside operating hours). */
export function postponeJob(db: Db, id: string, runAt: Date, note?: string): void {
  db.update(jobs)
    .set({
      status: "pending",
      runAt: runAt.toISOString(),
      lockedAt: null,
      lockedBy: null,
      attempts: sql`MAX(${jobs.attempts} - 1, 0)`,
      lastError: note ?? null,
      updatedAt: nowIso(),
    })
    .where(eq(jobs.id, id))
    .run();
}

export function listJobs(db: Db, limit = 100) {
  return db.select().from(jobs).orderBy(desc(jobs.updatedAt)).limit(limit).all();
}

export function countJobsByStatus(db: Db): Record<string, number> {
  const rows = db.select({ status: jobs.status, count: sql<number>`count(*)` }).from(jobs).groupBy(jobs.status).all();
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

export function retryDeadJob(db: Db, id: string): void {
  const now = nowIso();
  db.update(jobs).set({ status: "pending", attempts: 0, runAt: now, finishedAt: null, updatedAt: now }).where(and(eq(jobs.id, id), eq(jobs.status, "dead"))).run();
}

export function parsePayload<T>(job: Job): T {
  return JSON.parse(job.payload) as T;
}
