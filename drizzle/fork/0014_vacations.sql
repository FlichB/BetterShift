CREATE TABLE `vacation_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`vacation_id` text NOT NULL,
	`kind` text NOT NULL,
	`start_date` text,
	`end_date` text,
	`note` text,
	`status` text NOT NULL,
	`requested_by` text,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`vacation_id`) REFERENCES `vacations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vacation_changes_open_idx` ON `vacation_changes` (`vacation_id`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `vacation_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`vacation_id` text NOT NULL,
	`change_id` text,
	`previous_start` text,
	`previous_end` text,
	`actor_user_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`vacation_id`) REFERENCES `vacations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`change_id`) REFERENCES `vacation_changes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vacation_outbox_due_idx` ON `vacation_outbox` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE TABLE `vacations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`note` text,
	`status` text NOT NULL,
	`requested_by` text,
	`decided_by` text,
	`decided_at` integer,
	`decision_note` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`decided_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `vacations_user_start_idx` ON `vacations` (`user_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `vacations_status_idx` ON `vacations` (`status`);--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `my_vacations` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `notification_preferences` ADD `vacation_requests` integer DEFAULT true NOT NULL;