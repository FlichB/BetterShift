CREATE TABLE `outlook_events` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`rotation_id` text NOT NULL,
	`event_id` text,
	`ical_uid` text,
	`transaction_id` text,
	`fingerprint` text,
	`state` text DEFAULT 'active' NOT NULL,
	`starts_at` integer NOT NULL,
	`synced_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text
);
--> statement-breakpoint
CREATE INDEX `outlook_events_rotationId_idx` ON `outlook_events` (`rotation_id`);--> statement-breakpoint
CREATE INDEX `outlook_events_state_next_idx` ON `outlook_events` (`state`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `notification_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`swap_id` text NOT NULL,
	`actor_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`swap_id`) REFERENCES `shift_swaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `notification_outbox_status_next_idx` ON `notification_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`offers_to_all` integer DEFAULT true NOT NULL,
	`offers_to_me` integer DEFAULT true NOT NULL,
	`my_offers` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `rotations` ADD `outlook_enabled` integer DEFAULT false NOT NULL;