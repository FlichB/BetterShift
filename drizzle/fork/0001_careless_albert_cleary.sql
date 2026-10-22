CREATE TABLE `shift_swap_hidden` (
	`swap_id` text NOT NULL,
	`user_id` text NOT NULL,
	PRIMARY KEY(`swap_id`, `user_id`),
	FOREIGN KEY (`swap_id`) REFERENCES `shift_swaps`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `shift_swaps` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`offered_shift_id` text NOT NULL,
	`offered_by_user_id` text NOT NULL,
	`target_user_id` text,
	`requested_shift_id` text,
	`accepted_by_user_id` text,
	`accepted_shift_id` text,
	`note` text,
	`created_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`offered_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`offered_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accepted_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`accepted_shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shift_swaps_open_slot_idx` ON `shift_swaps` (`offered_shift_id`,`offered_by_user_id`) WHERE status = 'open';--> statement-breakpoint
CREATE INDEX `shift_swaps_status_idx` ON `shift_swaps` (`status`);--> statement-breakpoint
CREATE INDEX `shift_swaps_targetUserId_idx` ON `shift_swaps` (`target_user_id`);