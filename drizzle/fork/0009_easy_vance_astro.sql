CREATE TABLE `day_off_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`day_off_id` text NOT NULL,
	`proposal_id` text,
	`audience` text NOT NULL,
	`actor_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`day_off_id`) REFERENCES `day_offs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `day_off_proposals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `day_off_outbox_due_idx` ON `day_off_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `day_off_proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`day_off_id` text NOT NULL,
	`date` text NOT NULL,
	`side` text NOT NULL,
	`proposed_by_user_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`decline_reason` text,
	`resolved_by_user_id` text,
	`reminded_at` integer,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`day_off_id`) REFERENCES `day_offs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`resolved_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `day_off_proposals_day_off_idx` ON `day_off_proposals` (`day_off_id`,`status`);--> statement-breakpoint
CREATE TABLE `day_offs` (
	`id` text PRIMARY KEY NOT NULL,
	`rotation_id` text NOT NULL,
	`shift_id` text,
	`duty_date` text NOT NULL,
	`user_id` text NOT NULL,
	`status` text NOT NULL,
	`standard_date` text,
	`date` text,
	`locked_by_user_id` text,
	`agreed_by_user_id` text,
	`lock_note` text,
	`drop_reason` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`rotation_id`) REFERENCES `rotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`locked_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`agreed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `day_offs_seat_idx` ON `day_offs` (`shift_id`,`user_id`) WHERE shift_id is not null and status != 'dropped';--> statement-breakpoint
CREATE INDEX `day_offs_user_date_idx` ON `day_offs` (`user_id`,`date`);--> statement-breakpoint
CREATE INDEX `day_offs_rotation_idx` ON `day_offs` (`rotation_id`);--> statement-breakpoint
ALTER TABLE `rotations` ADD `day_off_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `rotations` ADD `day_off_title` text DEFAULT '{Vorname} dienstfrei' NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `my_day_offs` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `day_off_requests` integer DEFAULT true NOT NULL;--> statement-breakpoint
-- [fork] SPEC 12.36: every existing bundle gets moveOwnDayOff (hand-written, never regenerate).
UPDATE calendar_permission_bundles
SET capabilities = json_insert(capabilities, '$[#]', 'moveOwnDayOff')
WHERE NOT EXISTS (SELECT 1 FROM json_each(calendar_permission_bundles.capabilities) WHERE value = 'moveOwnDayOff');
