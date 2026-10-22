CREATE TABLE `rotation_duties` (
	`shift_id` text PRIMARY KEY NOT NULL,
	`rotation_id` text NOT NULL,
	`date` text NOT NULL,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rotation_id`) REFERENCES `rotations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rotation_duties_rotationId_date_idx` ON `rotation_duties` (`rotation_id`,`date`);--> statement-breakpoint
CREATE TABLE `rotation_members` (
	`rotation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`rotation_id`, `user_id`),
	FOREIGN KEY (`rotation_id`) REFERENCES `rotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `rotation_slot_locks` (
	`shift_id` text NOT NULL,
	`user_id` text NOT NULL,
	`replaces_user_id` text,
	`locked_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`shift_id`, `user_id`),
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`replaces_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `rotations` (
	`id` text PRIMARY KEY NOT NULL,
	`calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`preset_id` text,
	`per_shift` integer NOT NULL,
	`period` text NOT NULL,
	`period_days` integer,
	`start_date` text NOT NULL,
	`start_offset` integer DEFAULT 0 NOT NULL,
	`weekdays` text DEFAULT '[]' NOT NULL,
	`skip_dates` text DEFAULT '[]' NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`calendar_id`) REFERENCES `calendars`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`preset_id`) REFERENCES `shift_presets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `rotations_calendarId_idx` ON `rotations` (`calendar_id`);