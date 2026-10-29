ALTER TABLE `rotations` ADD `day_off_timing` text DEFAULT 'after' NOT NULL;--> statement-breakpoint
ALTER TABLE `day_offs` ADD `kept_on_swap` integer DEFAULT false NOT NULL;