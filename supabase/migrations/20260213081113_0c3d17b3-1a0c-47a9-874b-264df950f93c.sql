
-- Add new columns
ALTER TABLE public.verbs ADD COLUMN IF NOT EXISTS verb_key text;
ALTER TABLE public.verbs ADD COLUMN IF NOT EXISTS base_verb text;

-- Copy existing verb data to new columns
UPDATE public.verbs SET verb_key = verb, base_verb = verb WHERE verb_key IS NULL;

-- Make verb_key NOT NULL and UNIQUE
ALTER TABLE public.verbs ALTER COLUMN verb_key SET NOT NULL;
ALTER TABLE public.verbs ALTER COLUMN base_verb SET NOT NULL;
ALTER TABLE public.verbs ADD CONSTRAINT verbs_verb_key_unique UNIQUE (verb_key);

-- Drop old verb column
ALTER TABLE public.verbs DROP COLUMN verb;
