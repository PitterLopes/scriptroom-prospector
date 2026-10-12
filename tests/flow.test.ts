import { describe, expect, it } from "vitest";
import { SAMPLE_PROFILES, buildContext } from "./helpers";
import { claimNext, completeJob, enqueue, listJobs, postponeJob } from "@/db/queries/jobs";
import { getLead, getLeadByUsername, getOrCreateConversation, isDoNotContact, listMessages, upsertDiscoveredLead } from "@/db/queries/leads";
import { getPause, setSetting } from "@/db/queries/settings";
import { listOpenExceptions } from "@/db/queries/events";
import { runOnce } from "@/worker/index";
import { discoverProfiles } from "@/worker/handlers/discover";
import { enrichAndScore } from "@/worker/handlers/enrich";
import { sendFirstDm } from "@/worker/handlers/first-dm";
import { processInbound } from "@/worker/handlers/inbound";
import { sendApiReply } from "@/worker/handlers/api-reply";
import { followUp } from "@/worker/handlers/follow-up";
import { monthlySpendUsd } from "@/db/queries/ai";
import type { Job } from "@/db/schema";

function job(type: Job["type"], payload: Record<string, unknown>, leadId?: string): Job {
  const now = new Date().toISOString();
  return { id: `job-${Math.random().toString(36).slice(2)}`, type, payload: JSON.stringify(payload), status: "running", runAt: now, attempts: 1, maxAttempts: 3, lastError: null, lockedAt: now, lockedBy: "test", idempotencyKey: null, leadId: leadId ?? null, finishedAt: null, createdAt: now, updatedAt: now };
}

async function discoverAndQualify(ctx: ReturnType<typeof buildContext>["ctx"], db: ReturnType<typeof buildContext>["db"]) {
  const discovered = await discoverProfiles(job("discover_profiles", { funnel: "customers", query: "dentista", limit: 10 }), ctx);
  expect(discovered.kind).toBe("done");
  const ana = getLeadByUsername(db, "dra.ana.sorriso")!;
  const student = getLeadByUsername(db, "estagiario.odonto")!;
  expect(ana.pipelineState).toBe("discovered");
  expect((await enrichAndScore(job("enrich_and_score", { leadId: ana.id }, ana.id), ctx)).kind).toBe("done");
  expect((await enrichAndScore(job("enrich_and_score", { leadId: student.id }, student.id), ctx)).kind).toBe("done");
  expect(getLead(db, ana.id)!.pipelineState).toBe("qualified");
  expect(getLead(db, student.id)!.pipelineState).toBe("closed");
  return getLead(db, ana.id)!;
}

describe("discovery → scoring → first DM", () => {
  it("dry-run types the message but never sends, and does not retry the same lead", async () => {
    const { ctx, db, browser } = buildContext();
    const ana = await discoverAndQualify(ctx, db);
    const result = await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx);
    expect(result).toMatchObject({ kind: "done", note: "dry-run" });
    expect(browser.sent).toHaveLength(1);
    expect(browser.sent[0]!.dryRun).toBe(true);
    const after = getLead(db, ana.id)!;
    expect(after.pipelineState).toBe("qualified");
    expect(JSON.parse(after.tags)).toContain("dry_run");
    expect(listMessages(db, ana.id)[0]!.status).toBe("dry_run");
    const again = await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx);
    expect(again).toMatchObject({ kind: "done", note: "already simulated" });
  });

  it("real send needs both the env flag and the panel switch, then moves pipeline and channel", async () => {
    const { ctx, db, browser } = buildContext({ env: { BROWSER_SEND_ENABLED: true } });
    const ana = await discoverAndQualify(ctx, db);
    expect(ctx.sendEnabled()).toBe(false);
    setSetting(db, "browser.sendEnabled", true);
    expect(ctx.sendEnabled()).toBe(true);
    const result = await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx);
    expect(result).toMatchObject({ kind: "done", note: "sent" });
    expect(browser.sent[0]!.dryRun).toBe(false);
    const after = getLead(db, ana.id)!;
    expect(after.pipelineState).toBe("contacted");
    expect(after.channelState).toBe("waiting_inbound_reply");
    expect(listMessages(db, ana.id)[0]!.status).toBe("sent");
    const second = await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx);
    expect(second.kind).toBe("done");
    expect(browser.sent).toHaveLength(1);
  });

  it("a lead simulated in dry-run is contacted for real once sending is turned on, without tripping the duplicate breaker", async () => {
    const { ctx, db, browser } = buildContext({ env: { BROWSER_SEND_ENABLED: true } });
    const ana = await discoverAndQualify(ctx, db);
    expect(await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx)).toMatchObject({ kind: "done", note: "dry-run" });
    setSetting(db, "browser.sendEnabled", true);
    const real = await sendFirstDm(job("send_first_dm", { leadId: ana.id }, ana.id), ctx);
    expect(real).toMatchObject({ kind: "done", note: "sent" });
    expect(browser.sent.map((s) => s.dryRun)).toEqual([true, false]);
    expect(getPause(db).paused).toBe(false);
    const statuses = listMessages(db, ana.id).map((m) => m.status).sort();
    expect(statuses).toEqual(["dry_run", "sent"]);
    expect(getLead(db, ana.id)!.channelState).toBe("waiting_inbound_reply");
  });

  it("respects the daily allowance (warm-up) and postpones", async () => {
    const extra = { username: "outra.dentista", exists: true, isPrivate: false, fullName: "Dra. B", bio: "Dentista CRO-PE 1 em Recife. Reels toda semana", followers: 2000, posts: 50, isBusiness: true, keywords: ["dentista"], recentPosts: [{ url: "https://www.instagram.com/reel/x1/", caption: "Dica rápida: como escovar com aparelho", postedAt: new Date().toISOString(), kind: "reel" as const }] };
    const { ctx, db } = buildContext({ env: { BROWSER_SEND_ENABLED: true, WARMUP_START_PER_DAY: 1 }, browser: { profiles: [...SAMPLE_PROFILES!, extra] } });
    setSetting(db, "browser.sendEnabled", true);
    const ana = await discoverAndQualify(ctx, db);
    const other = getLeadByUsername(db, "outra.dentista")!;
    expect((await enrichAndScore(job("enrich_and_score", { leadId: other.id }), ctx)).kind).toBe("done");
    expect(getLead(db, other.id)!.pipelineState).toBe("qualified");
    expect((await sendFirstDm(job("send_first_dm", { leadId: ana.id }), ctx)).kind).toBe("done");
    const blocked = await sendFirstDm(job("send_first_dm", { leadId: other.id }), ctx);
    expect(blocked.kind).toBe("postpone");
    if (blocked.kind === "postpone") expect(blocked.note).toBe("daily_cap");
  });

  it("pauses everything when Instagram shows a restriction, and when Chrome is unavailable only the browser queue pauses", async () => {
    const restricted = buildContext({ env: { BROWSER_SEND_ENABLED: true }, browser: { restrictedAfterSends: 0 } });
    setSetting(restricted.db, "browser.sendEnabled", true);
    const ana = await discoverAndQualify(restricted.ctx, restricted.db);
    const result = await sendFirstDm(job("send_first_dm", { leadId: ana.id }), restricted.ctx);
    expect(result.kind).toBe("done");
    expect(getPause(restricted.db).paused).toBe(true);
    expect(listOpenExceptions(restricted.db).map((e) => e.kind)).toContain("instagram_restriction");

    const offline = buildContext({ browser: { unavailable: true } });
    const r = await discoverProfiles(job("discover_profiles", { funnel: "customers", query: "dentista", limit: 5 }), offline.ctx);
    expect(r.kind).toBe("postpone");
    expect(getPause(offline.db).paused).toBe(false);
    expect(listOpenExceptions(offline.db).map((e) => e.kind)).toContain("browser_unavailable");
  });

  it("stops before any model call when the monthly budget is spent", async () => {
    const { ctx, db } = buildContext({ env: { OPENROUTER_MONTHLY_BUDGET_USD: 0.001 }, ai: { costPerCall: 0.001 } });
    const ana = await discoverAndQualify(ctx, db);
    const first = await sendFirstDm(job("send_first_dm", { leadId: ana.id }), ctx);
    expect(first.kind).toBe("done");
    expect(monthlySpendUsd(db)).toBeGreaterThan(0);
    const other = upsertDiscoveredLead(db, "customers", { username: "mais.uma", source: "manual" });
    if (other.status !== "created") throw new Error();
    db.update((await import("@/db/schema")).leads).set({ pipelineState: "qualified" }).run();
    const second = await sendFirstDm(job("send_first_dm", { leadId: other.lead.id }), ctx);
    expect(second).toMatchObject({ kind: "postpone", note: "AI budget reached" });
    expect(getPause(db).paused).toBe(true);
  });
});

describe("handoff browser → webhook → API", () => {
  async function contacted(options: Parameters<typeof buildContext>[0] = {}) {
    const built = buildContext({ ...options, env: { BROWSER_SEND_ENABLED: true, ...options.env } });
    setSetting(built.db, "browser.sendEnabled", true);
    const ana = await discoverAndQualify(built.ctx, built.db);
    await sendFirstDm(job("send_first_dm", { leadId: ana.id }), built.ctx);
    return { ...built, ana: getLead(built.db, ana.id)! };
  }

  it("matches the reply by username, hands the channel to the API and queues one idempotent reply", async () => {
    const { ctx, db, ana } = await contacted();
    const inbound = { mid: "mid_1", senderId: "123", recipientId: "17841400000000000", text: "Oi Pitter! Como funciona isso?", timestamp: new Date().toISOString(), attachments: 0 };
    const result = await processInbound(job("process_inbound", inbound), ctx);
    expect(result.kind).toBe("done");
    const after = getLead(db, ana.id)!;
    expect(after.igUserId).toBe("123");
    expect(after.pipelineState).toBe("replied");
    expect(after.channelState).toBe("api_active");
    expect(getOrCreateConversation(db, ana.id).channelOwner).toBe("api");
    const queued = listJobs(db).filter((j) => j.type === "send_api_reply");
    expect(queued).toHaveLength(1);
    const dup = await processInbound(job("process_inbound", inbound), ctx);
    expect(dup).toMatchObject({ kind: "done", note: "duplicate webhook event" });
    expect(listJobs(db).filter((j) => j.type === "send_api_reply")).toHaveLength(1);
  });

  it("a burst of short replies waits to settle and gets one answer, with the whole burst in front of the model", async () => {
    let clock = new Date();
    const aiCalls: Array<{ purpose: string; body: Record<string, unknown> }> = [];
    const { ctx, db, ana } = await contacted({ env: { INBOUND_SETTLE_SECONDS: 45 }, now: () => clock, aiCalls });
    const at = (seconds: number) => new Date(clock.getTime() + seconds * 1000).toISOString();
    const burst = [
      { mid: "b1", senderId: "123", recipientId: "x", text: "Olá boa tarde", timestamp: at(7), attachments: 0 },
      { mid: "b2", senderId: "123", recipientId: "x", text: "Posso testar sim", timestamp: at(13), attachments: 0 },
      { mid: "b3", senderId: "123", recipientId: "x", text: "Obrigada", timestamp: at(18), attachments: 0 },
    ];
    for (const m of burst) enqueue(db, "process_inbound", m, { idempotencyKey: `inbound:${m.mid}` });
    const runNext = async () => {
      const next = claimNext(db, "test", ["process_inbound"], clock)!;
      expect(next).not.toBeNull();
      const result = await processInbound(next, ctx);
      if (result.kind === "postpone") postponeJob(db, next.id, result.runAt, result.note);
      else completeJob(db, next.id);
      return result;
    };
    // Twenty seconds in, the whole burst is stored but nothing is answered yet.
    clock = new Date(clock.getTime() + 20_000);
    for (let i = 0; i < 3; i += 1) expect((await runNext()).kind).toBe("postpone");
    expect(listMessages(db, ana.id).filter((m) => m.direction === "inbound")).toHaveLength(3);
    expect(listJobs(db).filter((j) => j.type === "send_api_reply")).toHaveLength(0);
    // Once settled, the older messages step aside and the newest answers for all three.
    clock = new Date(clock.getTime() + 60_000);
    expect(await runNext()).toMatchObject({ kind: "done", note: expect.stringContaining("superseded") });
    expect(await runNext()).toMatchObject({ kind: "done", note: expect.stringContaining("superseded") });
    expect(await runNext()).toMatchObject({ kind: "done", note: expect.stringContaining("intent") });
    const replies = listJobs(db).filter((j) => j.type === "send_api_reply");
    expect(replies).toHaveLength(1);
    expect(replies[0]!.idempotencyKey).toBe("reply:b3");
    const classifyCall = aiCalls.find((c) => c.purpose === "classify")!;
    const seen = JSON.stringify(classifyCall.body);
    for (const m of burst) expect(seen).toContain(m.text);
    expect(getLead(db, ana.id)!.pipelineState).toBe("replied");
  });

  it("never closes a lead the model wanted to close while she is still interested: it becomes a follow-up", async () => {
    const { ctx, db, ana } = await contacted({ ai: { classify: { intent: "interested", summary: "vai testar" }, decide: { action: "close", reply: "", reasoning: "encerro de leve", pipeline_hint: "interested" } } });
    const result = await processInbound(job("process_inbound", { mid: "mid_close", senderId: "123", recipientId: "x", text: "Vou testar 🫶🏼", timestamp: new Date().toISOString(), attachments: 0 }), ctx);
    expect(result).toMatchObject({ kind: "done", note: "intent interested → schedule_follow_up" });
    const after = getLead(db, ana.id)!;
    expect(after.pipelineState).toBe("interested");
    expect(after.channelState).toBe("api_active");
    expect(after.nextAction).toBe("Follow-up");
    expect(after.nextActionAt).not.toBeNull();
  });

  it("sends the reply through the Graph API exactly once and never through the browser", async () => {
    const { ctx, db, ana, browser } = await contacted();
    await processInbound(job("process_inbound", { mid: "mid_2", senderId: "123", recipientId: "x", text: "Como funciona?", timestamp: new Date().toISOString(), attachments: 0 }), ctx);
    const replyJob = claimNext(db, "test", ["send_api_reply"])!;
    expect(replyJob).not.toBeNull();
    const sent = await sendApiReply(replyJob, ctx);
    expect(sent).toMatchObject({ kind: "done", note: "sent" });
    const messages = listMessages(db, ana.id);
    expect(messages.filter((m) => m.channel === "api" && m.direction === "outbound" && m.status === "sent")).toHaveLength(1);
    expect(browser.sent).toHaveLength(1);
    const again = await sendApiReply({ ...replyJob, id: "other" }, ctx);
    expect(again).toMatchObject({ kind: "done", note: "duplicate blocked" });
    expect(getPause(db).paused).toBe(true);
  });

  it("refuses to send through the API when the browser still owns the channel", async () => {
    const { ctx, db, ana } = await contacted();
    const result = await sendApiReply(job("send_api_reply", { leadId: ana.id, text: "oi", dedupeKey: "reply:x", action: "reply" }), ctx);
    expect(result).toMatchObject({ kind: "done", note: "channel not owned by api" });
    expect(listOpenExceptions(db).map((e) => e.kind)).toContain("channel_ownership");
  });

  it("closes the API window after 24 hours instead of falling back to the browser", async () => {
    const { ctx, db, ana, browser } = await contacted();
    const old = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    await processInbound(job("process_inbound", { mid: "mid_old", senderId: "123", recipientId: "x", text: "oi", timestamp: old, attachments: 0 }), ctx);
    const replyJob = claimNext(db, "test", ["send_api_reply"])!;
    const result = await sendApiReply(replyJob, ctx);
    expect(result).toMatchObject({ kind: "done", note: "window closed" });
    expect(getLead(db, ana.id)!.channelState).toBe("api_window_closed");
    expect(browser.sent).toHaveLength(1);
    const fu = await followUp(job("follow_up", { leadId: ana.id }), ctx);
    expect(fu.kind).toBe("done");
  });

  it("honors opt-out immediately and permanently", async () => {
    const { ctx, db, ana } = await contacted();
    await processInbound(job("process_inbound", { mid: "mid_3", senderId: "123", recipientId: "x", text: "Para de me mandar mensagem, por favor", timestamp: new Date().toISOString(), attachments: 0 }), ctx);
    const after = getLead(db, ana.id)!;
    expect(after.channelState).toBe("do_not_contact");
    expect(after.pipelineState).toBe("closed");
    expect(isDoNotContact(db, ana.username)).toBe(true);
    expect(listJobs(db).filter((j) => j.type === "send_api_reply")).toHaveLength(0);
  });

  it("escalates to a human when the model's reply fails the claims guard twice", async () => {
    const built = buildContext({ env: { BROWSER_SEND_ENABLED: true }, ai: { decide: { action: "reply", reply: "Somos o melhor app, garantido que você ganha seguidores." } } });
    setSetting(built.db, "browser.sendEnabled", true);
    const ana = await discoverAndQualify(built.ctx, built.db);
    await sendFirstDm(job("send_first_dm", { leadId: ana.id }), built.ctx);
    await processInbound(job("process_inbound", { mid: "mid_4", senderId: "123", recipientId: "x", text: "me conta mais", timestamp: new Date().toISOString(), attachments: 0 }), built.ctx);
    const after = getLead(built.db, ana.id)!;
    expect(after.channelState).toBe("human_review_required");
    expect(listJobs(built.db).filter((j) => j.type === "send_api_reply")).toHaveLength(0);
    expect(listOpenExceptions(built.db).map((e) => e.kind)).toContain("human_review");
  });

  it("ignores replies from people the system never prospected", async () => {
    const { ctx, db } = await contacted();
    const before = listJobs(db).length;
    const unknownGraph = (await import("./helpers")).fakeGraph([], { username: "amigo.pessoal" });
    const result = await processInbound(job("process_inbound", { mid: "mid_5", senderId: "999", recipientId: "x", text: "e aí", timestamp: new Date().toISOString(), attachments: 0 }), { ...ctx, graph: () => unknownGraph });
    expect(result).toMatchObject({ kind: "done", note: "not a prospected lead; ignored" });
    expect(listJobs(db).length).toBe(before);
  });
});

describe("worker loop", () => {
  it("schedules the day's jobs idempotently and survives a restart", async () => {
    const { ctx, db } = buildContext();
    const first = await runOnce(ctx, 50);
    expect(first.scheduled).toBeGreaterThan(0);
    const discoverBefore = listJobs(db, 500).filter((j) => j.type === "discover_profiles").length;
    const backupsBefore = listJobs(db, 500).filter((j) => j.type === "daily_backup").length;
    // The first pass already discovered and qualified leads through the fake browser, so the second
    // tick may legitimately schedule their first DM; what it must never do is repeat the day's jobs.
    const second = await runOnce(ctx, 50);
    const after = listJobs(db, 500);
    expect(after.filter((j) => j.type === "discover_profiles").length).toBe(discoverBefore);
    expect(after.filter((j) => j.type === "daily_backup").length).toBe(backupsBefore);
    expect(backupsBefore).toBe(1);
    const newTypes = new Set(after.slice(0, second.scheduled).map((j) => j.type));
    for (const t of newTypes) expect(["send_first_dm", "enrich_and_score"]).toContain(t);
    const types = new Set(after.map((j) => j.type));
    expect(types.has("discover_profiles")).toBe(true);
    expect(types.has("daily_backup")).toBe(true);
    enqueue(db, "daily_backup", {}, { idempotencyKey: "backup:test" });
    const restarted = buildContext({ db });
    const third = await runOnce(restarted.ctx, 5);
    expect(third.ran).toBeGreaterThanOrEqual(0);
  });
});
