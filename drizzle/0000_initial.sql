CREATE TABLE `ai_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`prompt_tokens` integer DEFAULT 0 NOT NULL,
	`completion_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`ok` integer NOT NULL,
	`error` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_calls_created_idx` ON `ai_calls` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_calls_lead_idx` ON `ai_calls` (`lead_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`target` text,
	`details` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_idx` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`channel_owner` text DEFAULT 'none' NOT NULL,
	`api_window_expires_at` text,
	`last_inbound_at` text,
	`last_outbound_at` text,
	`last_intent` text,
	`follow_ups_sent` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_lead_unique` ON `conversations` (`lead_id`);--> statement-breakpoint
CREATE TABLE `do_not_contact` (
	`username` text PRIMARY KEY NOT NULL,
	`ig_user_id` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exceptions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`lead_id` text,
	`job_id` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`resolved_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `exceptions_open_idx` ON `exceptions` (`resolved_at`,`created_at`);--> statement-breakpoint
CREATE TABLE `experiment_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variant_id`) REFERENCES `experiment_variants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `experiment_assignments_unique` ON `experiment_assignments` (`experiment_id`,`lead_id`);--> statement-breakpoint
CREATE TABLE `experiment_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`experiment_id` text NOT NULL,
	`name` text NOT NULL,
	`is_control` integer DEFAULT false NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`experiment_id`) REFERENCES `experiments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `experiment_variants_experiment_idx` ON `experiment_variants` (`experiment_id`);--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`variable` text NOT NULL,
	`funnel` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`exploration_share` real DEFAULT 0.2 NOT NULL,
	`min_sample_size` integer DEFAULT 30 NOT NULL,
	`winner_variant_id` text,
	`concluded_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`run_at` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 5 NOT NULL,
	`last_error` text,
	`locked_at` text,
	`locked_by` text,
	`idempotency_key` text,
	`lead_id` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_unique` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_status_run_at_idx` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `jobs_lead_idx` ON `jobs` (`lead_id`);--> statement-breakpoint
CREATE TABLE `lead_events` (
	`id` text PRIMARY KEY NOT NULL,
	`lead_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `lead_events_lead_idx` ON `lead_events` (`lead_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `leads` (
	`id` text PRIMARY KEY NOT NULL,
	`funnel` text NOT NULL,
	`username` text NOT NULL,
	`ig_user_id` text,
	`full_name` text,
	`bio` text,
	`category` text,
	`followers` integer,
	`following` integer,
	`posts` integer,
	`is_business` integer,
	`external_url` text,
	`location` text,
	`recent_posts_summary` text,
	`last_public_post_at` text,
	`source` text NOT NULL,
	`source_detail` text,
	`segment` text,
	`icp_score` integer DEFAULT 0 NOT NULL,
	`icp_reasons` text DEFAULT '[]' NOT NULL,
	`role_guess` text DEFAULT 'unknown' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`best_send_window` text,
	`pipeline_state` text NOT NULL,
	`channel_state` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`next_action` text,
	`next_action_at` text,
	`discovered_at` text NOT NULL,
	`contacted_at` text,
	`replied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `leads_username_unique` ON `leads` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `leads_ig_user_id_unique` ON `leads` (`ig_user_id`);--> statement-breakpoint
CREATE INDEX `leads_pipeline_idx` ON `leads` (`funnel`,`pipeline_state`);--> statement-breakpoint
CREATE INDEX `leads_channel_idx` ON `leads` (`channel_state`);--> statement-breakpoint
CREATE INDEX `leads_next_action_idx` ON `leads` (`next_action_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`lead_id` text NOT NULL,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`text` text NOT NULL,
	`external_id` text,
	`dedupe_key` text,
	`variant_id` text,
	`status` text NOT NULL,
	`error` text,
	`sent_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external_id_unique` ON `messages` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `messages_dedupe_key_unique` ON `messages` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`processed_at` text,
	`error` text,
	`received_at` text NOT NULL
);
