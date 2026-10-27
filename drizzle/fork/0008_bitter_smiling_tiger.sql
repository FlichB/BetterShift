ALTER TABLE `shift_swaps` ADD `forced_by_user_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `shift_swaps` ADD `counter_status` text;--> statement-breakpoint
ALTER TABLE `shift_swaps` ADD `counter_window_end` text;--> statement-breakpoint
ALTER TABLE `shift_swaps` ADD `counter_resolved_by_user_id` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `shift_swaps` ADD `waive_reason` text;--> statement-breakpoint
CREATE INDEX `shift_swaps_counter_pending_idx` ON `shift_swaps` (`accepted_by_user_id`) WHERE counter_status = 'pending';