CREATE TABLE `external_sync_windows` (
	`external_sync_id` text PRIMARY KEY NOT NULL,
	`years_ahead` integer NOT NULL,
	FOREIGN KEY (`external_sync_id`) REFERENCES `external_syncs`(`id`) ON UPDATE no action ON DELETE cascade
);
