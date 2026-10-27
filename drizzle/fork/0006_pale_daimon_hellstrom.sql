PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_outlook_events` (
	`event_key` text PRIMARY KEY NOT NULL,
	`shift_id` text NOT NULL,
	`user_id` text,
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
INSERT INTO `__new_outlook_events`("event_key", "shift_id", "user_id", "rotation_id", "event_id", "ical_uid", "transaction_id", "fingerprint", "state", "starts_at", "synced_at", "attempts", "next_attempt_at", "last_error") SELECT "shift_id", "shift_id", NULL, "rotation_id", "event_id", "ical_uid", "transaction_id", "fingerprint", "state", "starts_at", "synced_at", "attempts", "next_attempt_at", "last_error" FROM `outlook_events`;--> statement-breakpoint
DROP TABLE `outlook_events`;--> statement-breakpoint
ALTER TABLE `__new_outlook_events` RENAME TO `outlook_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `outlook_events_rotationId_idx` ON `outlook_events` (`rotation_id`);--> statement-breakpoint
CREATE INDEX `outlook_events_shiftId_idx` ON `outlook_events` (`shift_id`);--> statement-breakpoint
CREATE INDEX `outlook_events_state_next_idx` ON `outlook_events` (`state`,`next_attempt_at`);