
-- Rename example columns to anchor columns
ALTER TABLE public.verbs RENAME COLUMN example_short_1 TO anchor_short_1;
ALTER TABLE public.verbs RENAME COLUMN example_short_2 TO anchor_short_2;
ALTER TABLE public.verbs RENAME COLUMN example_short_3 TO anchor_short_3;
ALTER TABLE public.verbs RENAME COLUMN example_long_1 TO anchor_long_1;
ALTER TABLE public.verbs RENAME COLUMN example_long_2 TO anchor_long_2;
ALTER TABLE public.verbs RENAME COLUMN example_long_3 TO anchor_long_3;

-- Rename situation columns to situation_seed
ALTER TABLE public.verbs RENAME COLUMN situation_1 TO situation_seed_1;
ALTER TABLE public.verbs RENAME COLUMN situation_2 TO situation_seed_2;
ALTER TABLE public.verbs RENAME COLUMN situation_3 TO situation_seed_3;
ALTER TABLE public.verbs RENAME COLUMN situation_4 TO situation_seed_4;

-- Drop situation_5 (no longer used)
ALTER TABLE public.verbs DROP COLUMN IF EXISTS situation_5;
