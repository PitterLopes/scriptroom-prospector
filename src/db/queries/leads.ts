import { and, asc, desc, eq, gte, inArray, isNotNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "../client";
import { conversations, doNotContact, leads, messages, type Conversation, type Lead, type Message } from "../schema";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import {
  canMoveChannel,
  canMovePipeline,
  channelOwner,
  type ChannelState,
  type Funnel,
  type PipelineState,
} from "@/features/leads/states";
import { normalizeUsername } from "@/features/leads/dedupe";
import { recordLeadEvent, type Actor } from "./events";

export type DiscoveredProfile = {
  username: string;
  fullName?: string | null;
  bio?: string | null;
  category?: string | null;
  followers?: number | null;
  following?: number | null;
  posts?: number | null;
  isBusiness?: boolean | null;
  externalUrl?: string | null;
  location?: string | null;
  recentPostsSummary?: string | null;
  recentPosts?: Array<{ url: string; caption: string; postedAt: string | null; kind: "post" | "reel" }> | null;
  lastPublicPostAt?: string | null;
  source: string;
  sourceDetail?: string | null;
};

export type UpsertResult = { status: "created"; lead: Lead } | { status: "duplicate"; lead: Lead } | { status: "do_not_contact" } | { status: "blocked"; lead: Lead };

/** Discovery entry point: refuses do-not-contact handles, never duplicates a username, refreshes public fields. */
export function upsertDiscoveredLead(db: Db, funnel: Funnel, profile: DiscoveredProfile): UpsertResult {
  const username = normalizeUsername(profile.username);
  if (isDoNotContact(db, username)) return { status: "do_not_contact" };
  const existing = db.select().from(leads).where(eq(leads.username, username)).get();
  const now = nowIso();
  if (existing) {
    if (existing.channelState === "blocked") return { status: "blocked", lead: existing };
    db.update(leads)
      .set({
        fullName: profile.fullName ?? existing.fullName,
        bio: profile.bio ?? existing.bio,
        category: profile.category ?? existing.category,
        followers: profile.followers ?? existing.followers,
        following: profile.following ?? existing.following,
        posts: profile.posts ?? existing.posts,
        isBusiness: profile.isBusiness ?? existing.isBusiness,
        externalUrl: profile.externalUrl ?? existing.externalUrl,
        location: profile.location ?? existing.location,
        recentPostsSummary: profile.recentPostsSummary ?? existing.recentPostsSummary,
        recentPosts: profile.recentPosts ? JSON.stringify(profile.recentPosts) : existing.recentPosts,
        lastPublicPostAt: profile.lastPublicPostAt ?? existing.lastPublicPostAt,
        updatedAt: now,
      })
      .where(eq(leads.id, existing.id))
      .run();
    return { status: "duplicate", lead: getLead(db, existing.id)! };
  }
  const id = newId();
  db.insert(leads)
    .values({
      id,
      funnel,
      username,
      fullName: profile.fullName ?? null,
      bio: profile.bio ?? null,
      category: profile.category ?? null,
      followers: profile.followers ?? null,
      following: profile.following ?? null,
      posts: profile.posts ?? null,
      isBusiness: profile.isBusiness ?? null,
      externalUrl: profile.externalUrl ?? null,
      location: profile.location ?? null,
      recentPostsSummary: profile.recentPostsSummary ?? null,
      recentPosts: JSON.stringify(profile.recentPosts ?? []),
      lastPublicPostAt: profile.lastPublicPostAt ?? null,
      source: profile.source,
      sourceDetail: profile.sourceDetail ?? null,
      pipelineState: "discovered",
      channelState: "browser_contact_pending",
      discoveredAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  recordLeadEvent(db, id, "discovered", "worker", { source: profile.source, sourceDetail: profile.sourceDetail ?? null });
  return { status: "created", lead: getLead(db, id)! };
}

export function getLead(db: Db, id: string): Lead | null {
  return db.select().from(leads).where(eq(leads.id, id)).get() ?? null;
}

export function getLeadByUsername(db: Db, username: string): Lead | null {
  return db.select().from(leads).where(eq(leads.username, normalizeUsername(username))).get() ?? null;
}

export function getLeadByIgUserId(db: Db, igUserId: string): Lead | null {
  return db.select().from(leads).where(eq(leads.igUserId, igUserId)).get() ?? null;
}

export function linkIgUserId(db: Db, leadId: string, igUserId: string): void {
  db.update(leads).set({ igUserId, updatedAt: nowIso() }).where(eq(leads.id, leadId)).run();
}

export function updateLeadFields(db: Db, id: string, fields: Partial<Omit<Lead, "id" | "createdAt">>): void {
  db.update(leads).set({ ...fields, updatedAt: nowIso() }).where(eq(leads.id, id)).run();
}

export class TransitionError extends Error {}

/** Pipeline moves are validated against the funnel's state machine and recorded as events. */
export function movePipeline(db: Db, lead: Lead, to: PipelineState, actor: Actor, reason?: string): Lead {
  const from = lead.pipelineState as PipelineState;
  if (!canMovePipeline(lead.funnel as Funnel, from, to)) {
    throw new TransitionError(`Pipeline cannot move from ${from} to ${to} (${lead.funnel})`);
  }
  if (from === to) return lead;
  const now = nowIso();
  const extra: Partial<Lead> = {};
  if (to === "contacted") extra.contactedAt = now;
  if (to === "replied") extra.repliedAt = now;
  db.update(leads).set({ pipelineState: to, updatedAt: now, ...extra }).where(eq(leads.id, lead.id)).run();
  recordLeadEvent(db, lead.id, "pipeline_changed", actor, { from, to, reason: reason ?? null });
  return getLead(db, lead.id)!;
}

export function moveChannel(db: Db, lead: Lead, to: ChannelState, actor: Actor, reason?: string): Lead {
  const from = lead.channelState as ChannelState;
  if (!canMoveChannel(from, to)) {
    throw new TransitionError(`Channel cannot move from ${from} to ${to}`);
  }
  if (from === to) return lead;
  const now = nowIso();
  db.update(leads).set({ channelState: to, updatedAt: now }).where(eq(leads.id, lead.id)).run();
  const conversation = getOrCreateConversation(db, lead.id);
  db.update(conversations).set({ channelOwner: channelOwner(to), updatedAt: now }).where(eq(conversations.id, conversation.id)).run();
  recordLeadEvent(db, lead.id, "channel_changed", actor, { from, to, reason: reason ?? null });
  return getLead(db, lead.id)!;
}

/** Permanent, cross-campaign, cross-channel. */
export function markDoNotContact(db: Db, lead: Lead, reason: string, actor: Actor): Lead {
  db.insert(doNotContact)
    .values({ username: lead.username, igUserId: lead.igUserId, reason, createdAt: nowIso() })
    .onConflictDoNothing()
    .run();
  const updated = moveChannel(db, lead, "do_not_contact", actor, reason);
  db.update(leads).set({ nextAction: null, nextActionAt: null, updatedAt: nowIso() }).where(eq(leads.id, lead.id)).run();
  return canMovePipeline(lead.funnel as Funnel, updated.pipelineState as PipelineState, "closed")
    ? movePipeline(db, updated, "closed", actor, reason)
    : updated;
}

export function isDoNotContact(db: Db, username: string): boolean {
  return Boolean(db.select().from(doNotContact).where(eq(doNotContact.username, normalizeUsername(username))).get());
}

export function addDoNotContact(db: Db, username: string, reason: string): void {
  db.insert(doNotContact).values({ username: normalizeUsername(username), reason, createdAt: nowIso() }).onConflictDoNothing().run();
}

export function listDoNotContact(db: Db) {
  return db.select().from(doNotContact).orderBy(desc(doNotContact.createdAt)).all();
}

export function getOrCreateConversation(db: Db, leadId: string): Conversation {
  const existing = db.select().from(conversations).where(eq(conversations.leadId, leadId)).get();
  if (existing) return existing;
  const now = nowIso();
  const id = newId();
  db.insert(conversations).values({ id, leadId, channelOwner: "none", createdAt: now, updatedAt: now }).onConflictDoNothing().run();
  return db.select().from(conversations).where(eq(conversations.leadId, leadId)).get()!;
}

export function updateConversation(db: Db, id: string, fields: Partial<Omit<Conversation, "id" | "leadId" | "createdAt">>): void {
  db.update(conversations).set({ ...fields, updatedAt: nowIso() }).where(eq(conversations.id, id)).run();
}

export type NewMessageInput = {
  leadId: string;
  direction: "outbound" | "inbound";
  channel: "browser" | "api";
  text: string;
  status: "planned" | "dry_run" | "sent" | "failed" | "received";
  externalId?: string | null;
  dedupeKey?: string | null;
  variantId?: string | null;
  error?: string | null;
  sentAt?: string | null;
};

/** Inserts a message; a repeated dedupe key or external id returns null instead of a second row. */
export function insertMessage(db: Db, input: NewMessageInput): Message | null {
  const conversation = getOrCreateConversation(db, input.leadId);
  const id = newId();
  const now = nowIso();
  const result = db
    .insert(messages)
    .values({
      id,
      conversationId: conversation.id,
      leadId: input.leadId,
      direction: input.direction,
      channel: input.channel,
      text: input.text,
      externalId: input.externalId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      variantId: input.variantId ?? null,
      status: input.status,
      error: input.error ?? null,
      sentAt: input.sentAt ?? null,
      createdAt: now,
    })
    .onConflictDoNothing()
    .run();
  if (result.changes === 0) return null;
  const stamp = input.direction === "inbound" ? { lastInboundAt: now } : { lastOutboundAt: now };
  updateConversation(db, conversation.id, stamp);
  return db.select().from(messages).where(eq(messages.id, id)).get() ?? null;
}

export function updateMessage(db: Db, id: string, fields: Partial<Pick<Message, "status" | "error" | "sentAt" | "externalId">>): void {
  db.update(messages).set(fields).where(eq(messages.id, id)).run();
}

export function getMessageByExternalId(db: Db, externalId: string): Message | null {
  return db.select().from(messages).where(eq(messages.externalId, externalId)).get() ?? null;
}

export function listMessages(db: Db, leadId: string): Message[] {
  return db.select().from(messages).where(eq(messages.leadId, leadId)).orderBy(asc(messages.createdAt)).all();
}

/** Outbound browser DMs that actually went out (not dry-runs) in a UTC day window. */
export function countBrowserDmsSentBetween(db: Db, fromIso: string, toIso: string): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "outbound"),
        eq(messages.channel, "browser"),
        eq(messages.status, "sent"),
        isNotNull(messages.sentAt),
        gte(messages.sentAt, fromIso),
        lte(messages.sentAt, toIso),
      ),
    )
    .get();
  return row?.count ?? 0;
}

export function lastBrowserDmSentAt(db: Db): string | null {
  const row = db
    .select({ sentAt: messages.sentAt })
    .from(messages)
    .where(and(eq(messages.direction, "outbound"), eq(messages.channel, "browser"), eq(messages.status, "sent")))
    .orderBy(desc(messages.sentAt))
    .limit(1)
    .get();
  return row?.sentAt ?? null;
}

export function listLeads(db: Db, filter: { funnel?: Funnel; pipelineState?: PipelineState; channelState?: ChannelState; search?: string } = {}, limit = 500): Lead[] {
  const conditions = [];
  if (filter.funnel) conditions.push(eq(leads.funnel, filter.funnel));
  if (filter.pipelineState) conditions.push(eq(leads.pipelineState, filter.pipelineState));
  if (filter.channelState) conditions.push(eq(leads.channelState, filter.channelState));
  if (filter.search) {
    const term = `%${filter.search.toLowerCase()}%`;
    conditions.push(or(sql`lower(${leads.username}) like ${term}`, sql`lower(coalesce(${leads.fullName}, '')) like ${term}`, sql`lower(coalesce(${leads.bio}, '')) like ${term}`)!);
  }
  return db
    .select()
    .from(leads)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(leads.priority), desc(leads.updatedAt))
    .limit(limit)
    .all();
}

export function countLeadsByPipeline(db: Db, funnel: Funnel): Record<string, number> {
  const rows = db
    .select({ state: leads.pipelineState, count: sql<number>`count(*)` })
    .from(leads)
    .where(eq(leads.funnel, funnel))
    .groupBy(leads.pipelineState)
    .all();
  return Object.fromEntries(rows.map((r) => [r.state, r.count]));
}

export function countLeadsByChannel(db: Db): Record<string, number> {
  const rows = db.select({ state: leads.channelState, count: sql<number>`count(*)` }).from(leads).groupBy(leads.channelState).all();
  return Object.fromEntries(rows.map((r) => [r.state, r.count]));
}

/** Qualified leads waiting for their first browser DM, best first. */
export function nextLeadsToContact(db: Db, funnel: Funnel, limit: number): Lead[] {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.funnel, funnel), eq(leads.pipelineState, "qualified"), eq(leads.channelState, "browser_contact_pending")))
    .orderBy(desc(leads.priority), asc(leads.discoveredAt))
    .limit(limit)
    .all();
}

export function leadsWithDueFollowUp(db: Db, now: Date = new Date()): Lead[] {
  return db
    .select()
    .from(leads)
    .where(and(isNotNull(leads.nextActionAt), lte(leads.nextActionAt, now.toISOString()), inArray(leads.channelState, ["api_active", "waiting_inbound_reply"])))
    .orderBy(asc(leads.nextActionAt))
    .all();
}

export function leadsNeedingEnrichment(db: Db, limit: number): Lead[] {
  return db
    .select()
    .from(leads)
    .where(and(eq(leads.pipelineState, "discovered"), eq(leads.channelState, "browser_contact_pending")))
    .orderBy(asc(leads.discoveredAt))
    .limit(limit)
    .all();
}
