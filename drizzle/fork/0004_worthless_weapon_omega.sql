ALTER TABLE `rotation_duties` ADD `kind` text DEFAULT 'duty' NOT NULL;--> statement-breakpoint
ALTER TABLE `rotations` ADD `holiday_calendar_id` text REFERENCES calendars(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `rotations` ADD `closed_title` text DEFAULT 'Geschlossen' NOT NULL;--> statement-breakpoint
ALTER TABLE `rotations` ADD `holiday_open_dates` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
UPDATE `rotations` SET `skip_dates` = (
  SELECT json_group_array(json_object('date', value, 'reason', 'Ausfalltag'))
  FROM json_each(`rotations`.`skip_dates`)
) WHERE json_type(`skip_dates`, '$[0]') = 'text';
