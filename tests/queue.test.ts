import { describe, expect, it } from "vitest";
import { openTestDatabase } from "@/db/client";
import { claimNext, completeJob, enqueue, failJob, listJobs, postponeJob, recoverStaleJobs } from "@/db/queries/jobs";
import { listOpenExceptions } from "@/db/queries/events";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

describe("durable job queue", () => {
  it("claims jobs in due order, one at a time, and ignores future jobs", () => {
    const db = openTestDatabase();
    const now = new Date("2026-10-12T12:00:00Z");
    enqueue(db, "daily_backup", {}, { runAt: new Date("2026-10-12T11:00:00Z") });
    enqueue(db, "review_experiments", {}, { runAt: new Date("2026-10-12T13:00:00Z") });
    const first = claimNext(db, "w1", ["daily_backup", "review_experiments"], now);
    expect(first?.type).toBe("daily_backup");
    expect(first?.status).toBe("running");
    expect(claimNext(db, "w1", ["daily_backup", "review_experiments"], now)).toBeNull();
  });

  it("claims by priority before due time: a reply beats a discovery that was due earlier", () => {
    const db = openTestDatabase();
    const now = new Date("2026-10-12T12:00:00Z");
    enqueue(db, "discover_profiles", { q: 1 }, { runAt: new Date("2026-10-12T10:00:00Z") });
    enqueue(db, "send_first_dm", { leadId: "a" }, { runAt: new Date("2026-10-12T11:00:00Z") });
    enqueue(db, "send_api_reply", { leadId: "b" }, { runAt: new Date("2026-10-12T11:30:00Z") });
    const types = ["discover_profiles", "send_first_dm", "send_api_reply"] as const;
    expect(claimNext(db, "w", types, now)?.type).toBe("send_api_reply");
    expect(claimNext(db, "w", types, now)?.type).toBe("send_first_dm");
    expect(claimNext(db, "w", types, now)?.type).toBe("discover_profiles");
  });

  it("idempotency keys collapse duplicates", () => {
    const db = openTestDatabase();
    expect(enqueue(db, "send_first_dm", { leadId: "a" }, { idempotencyKey: "first_dm:a" })).not.toBeNull();
    expect(enqueue(db, "send_first_dm", { leadId: "a" }, { idempotencyKey: "first_dm:a" })).toBeNull();
    expect(listJobs(db)).toHaveLength(1);
  });

  it("retries with backoff and dies after maxAttempts, opening an exception", () => {
    const db = openTestDatabase();
    const now = new Date("2026-10-12T12:00:00Z");
    enqueue(db, "daily_backup", {}, { maxAttempts: 2, runAt: now });
    const first = claimNext(db, "w1", ["daily_backup"], now)!;
    expect(failJob(db, first, "disk full", now)).toBe("retry");
    const pending = db.select().from(jobs).where(eq(jobs.id, first.id)).get()!;
    expect(pending.status).toBe("pending");
    expect(new Date(pending.runAt).getTime()).toBeGreaterThan(now.getTime());
    const later = new Date(pending.runAt);
    const second = claimNext(db, "w1", ["daily_backup"], later)!;
    expect(failJob(db, second, "disk full again", later)).toBe("dead");
    expect(listOpenExceptions(db).map((e) => e.kind)).toContain("job_dead");
  });

  it("recovers jobs locked by a worker that died", () => {
    const db = openTestDatabase();
    const now = new Date("2026-10-12T12:00:00Z");
    enqueue(db, "daily_backup", {}, { runAt: now });
    const job = claimNext(db, "w1", ["daily_backup"], now)!;
    expect(recoverStaleJobs(db, new Date(now.getTime() + 5 * 60_000))).toBe(0);
    expect(recoverStaleJobs(db, new Date(now.getTime() + 20 * 60_000))).toBe(1);
    const recovered = claimNext(db, "w2", ["daily_backup"], new Date(now.getTime() + 21 * 60_000));
    expect(recovered?.id).toBe(job.id);
    completeJob(db, recovered!.id);
    expect(db.select().from(jobs).where(eq(jobs.id, job.id)).get()!.status).toBe("done");
  });

  it("postponing does not burn an attempt", () => {
    const db = openTestDatabase();
    const now = new Date("2026-10-12T12:00:00Z");
    enqueue(db, "daily_backup", {}, { runAt: now, maxAttempts: 1 });
    const job = claimNext(db, "w1", ["daily_backup"], now)!;
    postponeJob(db, job.id, new Date(now.getTime() + 60_000), "outside hours");
    const row = db.select().from(jobs).where(eq(jobs.id, job.id)).get()!;
    expect(row.attempts).toBe(0);
    expect(row.status).toBe("pending");
  });
});
