-- [fork] Jahresausgleich: 0011 backfilled joined_on with start_date. For a rotation restarted before
-- that migration, start_date is the restart date, so its earlier held duties made nobody a
-- Ganzjahres-Teilnehmer. Move such joined_on back to the rotation's earliest duty.
UPDATE `rotation_members` SET `joined_on` = (
  SELECT MIN(`d`.`date`) FROM `rotation_duties` `d`
  WHERE `d`.`rotation_id` = `rotation_members`.`rotation_id` AND `d`.`kind` = 'duty'
)
WHERE `joined_on` = (SELECT `r`.`start_date` FROM `rotations` `r` WHERE `r`.`id` = `rotation_members`.`rotation_id`)
  AND EXISTS (
    SELECT 1 FROM `rotation_duties` `d`
    WHERE `d`.`rotation_id` = `rotation_members`.`rotation_id` AND `d`.`kind` = 'duty' AND `d`.`date` < `rotation_members`.`joined_on`
  );
