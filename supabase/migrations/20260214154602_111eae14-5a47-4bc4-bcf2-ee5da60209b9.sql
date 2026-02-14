
-- Add verb_no column
ALTER TABLE public.verbs ADD COLUMN verb_no integer;

-- Backfill existing rows ordered by created_at
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM public.verbs
)
UPDATE public.verbs SET verb_no = numbered.rn
FROM numbered WHERE verbs.id = numbered.id;

-- Make it NOT NULL and UNIQUE after backfill
ALTER TABLE public.verbs ALTER COLUMN verb_no SET NOT NULL;
ALTER TABLE public.verbs ADD CONSTRAINT verbs_verb_no_unique UNIQUE (verb_no);

-- Create trigger to auto-assign verb_no on insert
CREATE OR REPLACE FUNCTION public.auto_assign_verb_no()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.verb_no IS NULL THEN
    SELECT COALESCE(MAX(verb_no), 0) + 1 INTO NEW.verb_no FROM public.verbs;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_auto_verb_no
BEFORE INSERT ON public.verbs
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_verb_no();
