-- Migrate scenario_events.aptitudes from array-of-names to array-of-{name,grade} objects.
-- Old shape: ["Turf", "Dirt"]
-- New shape: [{"name": "turf", "grade": "A"}, {"name": "dirt", "grade": "B"}]
--
-- Existing rows with the old string-array format are cleared (dev data only).
-- The hints column in scenario_events already uses {skill_id, levels} objects — no change needed.

update public.scenario_events
set aptitudes = '[]'::jsonb
where aptitudes != '[]'::jsonb;

-- Update column default to reflect new object shape (comment only — default '[]' is valid for both)
comment on column public.scenario_events.aptitudes is
  'Aptitude upgrades granted by this event. Shape: [{name: string, grade: string}] where name is the apt key (turf/dirt/short/mile/mid/long/leading/stalking/mid_pack/chasing) and grade is S/A/B/C/D/E/F/G.';
