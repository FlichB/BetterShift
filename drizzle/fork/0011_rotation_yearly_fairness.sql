CREATE TABLE `rotation_year_deltas` (
	`rotation_id` text NOT NULL,
	`year` integer NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`set_by` text,
	`set_at` integer DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`rotation_id`, `year`, `user_id`),
	FOREIGN KEY (`rotation_id`) REFERENCES `rotations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `rotation_members` ADD `joined_on` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `rotations` ADD `yearly_fairness` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `rotation_members` SET `joined_on` = (SELECT `start_date` FROM `rotations` WHERE `rotations`.`id` = `rotation_members`.`rotation_id`) WHERE `joined_on` = '';
