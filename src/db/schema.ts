import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
};

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    funnel: text("funnel").notNull(),
    username: text("username").notNull(),
    igUserId: text("ig_user_id"),
    fullName: text("full_name"),
    bio: text("bio"),
    category: text("category"),
    followers: integer("followers"),
    following: integer("following"),
    posts: integer("posts"),
    isBusiness: integer("is_business", { mode: "boolean" }),
    externalUrl: text("external_url"),
    location: text("location"),
    recentPostsSummary: text("recent_posts_summary"),
    lastPublicPostAt: text("last_public_post_at"),
    source: text("source").notNull(),
    sourceDetail: text("source_detail"),
    segment: text("segment"),
    icpScore: integer("icp_score").notNull().default(0),
    icpReasons: text("icp_reasons").notNull().default("[]"),
    roleGuess: text("role_guess").notNull().default("unknown"),
    priority: integer("priority").notNull().default(0),
    bestSendWindow: text("best_send_window"),
    pipelineState: text("pipeline_state").notNull(),
    channelState: text("channel_state").notNull(),
    tags: text("tags").notNull().default("[]"),
    notes: text("notes"),
    nextAction: text("next_action"),
    nextActionAt: text("next_action_at"),
    discoveredAt: text("discovered_at").notNull(),
    contactedAt: text("contacted_at"),
    repliedAt: text("replied_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("leads_username_unique").on(t.username),
    uniqueIndex("leads_ig_user_id_unique").on(t.igUserId),
    index("leads_pipeline_idx").on(t.funnel, t.pipelineState),
    index("leads_channel_idx").on(t.channelState),
    index("leads_next_action_idx").on(t.nextActionAt),
  ],
);

export const doNotContact = sqliteTable("do_not_contact", {
  username: text("username").primaryKey(),
  igUserId: text("ig_user_id"),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull(),
});

export const conversations = sqliteTable(
  "conversations",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    channelOwner: text("channel_owner").notNull().default("none"),
    apiWindowExpiresAt: text("api_window_expires_at"),
    lastInboundAt: text("last_inbound_at"),
    lastOutboundAt: text("last_outbound_at"),
    lastIntent: text("last_intent"),
    followUpsSent: integer("follow_ups_sent").notNull().default(0),
    summary: text("summary"),
    ...timestamps,
  },
  (t) => [uniqueIndex("conversations_lead_unique").on(t.leadId)],
);

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    conversationId: text("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    direction: text("direction").notNull(),
    channel: text("channel").notNull(),
    text: text("text").notNull(),
    externalId: text("external_id"),
    dedupeKey: text("dedupe_key"),
    variantId: text("variant_id"),
    status: text("status").notNull(),
    error: text("error"),
    sentAt: text("sent_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("messages_external_id_unique").on(t.externalId),
    uniqueIndex("messages_dedupe_key_unique").on(t.dedupeKey),
    index("messages_conversation_idx").on(t.conversationId, t.createdAt),
  ],
);

export const leadEvents = sqliteTable(
  "lead_events",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actor: text("actor").notNull(),
    payload: text("payload").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId, t.createdAt)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    payload: text("payload").notNull().default("{}"),
    status: text("status").notNull().default("pending"),
    runAt: text("run_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lastError: text("last_error"),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    idempotencyKey: text("idempotency_key"),
    leadId: text("lead_id"),
    finishedAt: text("finished_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("jobs_idempotency_unique").on(t.idempotencyKey),
    index("jobs_status_run_at_idx").on(t.status, t.runAt),
    index("jobs_lead_idx").on(t.leadId),
  ],
);

export const aiCalls = sqliteTable(
  "ai_calls",
  {
    id: text("id").primaryKey(),
    leadId: text("lead_id"),
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    ok: integer("ok", { mode: "boolean" }).notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("ai_calls_created_idx").on(t.createdAt), index("ai_calls_lead_idx").on(t.leadId)],
);

export const experiments = sqliteTable("experiments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  variable: text("variable").notNull(),
  funnel: text("funnel").notNull(),
  status: text("status").notNull().default("running"),
  explorationShare: real("exploration_share").notNull().default(0.2),
  minSampleSize: integer("min_sample_size").notNull().default(30),
  winnerVariantId: text("winner_variant_id"),
  concludedAt: text("concluded_at"),
  ...timestamps,
});

export const experimentVariants = sqliteTable(
  "experiment_variants",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    isControl: integer("is_control", { mode: "boolean" }).notNull().default(false),
    weight: real("weight").notNull().default(1),
    config: text("config").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("experiment_variants_experiment_idx").on(t.experimentId)],
);

export const experimentAssignments = sqliteTable(
  "experiment_assignments",
  {
    id: text("id").primaryKey(),
    experimentId: text("experiment_id").notNull().references(() => experiments.id, { onDelete: "cascade" }),
    variantId: text("variant_id").notNull().references(() => experimentVariants.id, { onDelete: "cascade" }),
    leadId: text("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull(),
  },
  (t) => [uniqueIndex("experiment_assignments_unique").on(t.experimentId, t.leadId)],
);

export const exceptions = sqliteTable(
  "exceptions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    leadId: text("lead_id"),
    jobId: text("job_id"),
    payload: text("payload").notNull().default("{}"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("exceptions_open_idx").on(t.resolvedAt, t.createdAt)],
);

export const webhookEvents = sqliteTable("webhook_events", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  processedAt: text("processed_at"),
  error: text("error"),
  receivedAt: text("received_at").notNull(),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    details: text("details").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AiCall = typeof aiCalls.$inferSelect;
export type Experiment = typeof experiments.$inferSelect;
export type ExperimentVariant = typeof experimentVariants.$inferSelect;
export type ExceptionRow = typeof exceptions.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
