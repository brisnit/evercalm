-- ===========================================================================
-- 0025 · A shift pattern's name is unique within its named week.
--
--   0015 made a pattern's name unique per location, which was right when a
--   pattern was a standalone thing a manager picked from a list. Round 2's
--   named weeks break that: two templates for the same restaurant will both
--   have a "Server · dinner", and refusing the second one is wrong.
--
--   So the rule splits along the same line the data does:
--
--     a standalone pattern (template_set_id is null)  unique per location,
--                                                     exactly as before
--     a pattern inside a named week                   unique within that week
--
--   Nothing existing changes meaning: every pattern that exists today has a
--   null template_set_id and keeps the guarantee it already had.
-- ===========================================================================

DROP INDEX "shift_templates_location_name_unique";--> statement-breakpoint

CREATE UNIQUE INDEX "shift_templates_location_name_unique"
  ON "shift_templates" ("organization_id","location_id",lower("name"))
  WHERE archived_at is null and template_set_id is null;--> statement-breakpoint

CREATE UNIQUE INDEX "shift_templates_set_name_unique"
  ON "shift_templates" ("organization_id","template_set_id",lower("name"))
  WHERE archived_at is null and template_set_id is not null;
