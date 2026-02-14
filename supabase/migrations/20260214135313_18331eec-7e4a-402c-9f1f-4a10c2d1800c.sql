
-- Add task_no and is_enabled columns (IF NOT EXISTS handles re-run safety)
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS task_no integer;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS is_enabled boolean NOT NULL DEFAULT true;

-- Backfill task_no for existing assignments per student, ordered by assigned_at
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY student_id ORDER BY assigned_at, id) AS rn
  FROM public.assignments
)
UPDATE public.assignments a
SET task_no = n.rn
FROM numbered n
WHERE a.id = n.id AND a.task_no IS NULL;

-- Now make task_no NOT NULL after backfill
ALTER TABLE public.assignments ALTER COLUMN task_no SET NOT NULL;

-- Add unique constraint on (student_id, task_no) for stability (skip if exists)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assignments_student_taskno_unique') THEN
    ALTER TABLE public.assignments ADD CONSTRAINT assignments_student_taskno_unique UNIQUE (student_id, task_no);
  END IF;
END$$;

-- Create index for fast task_no lookups
CREATE INDEX IF NOT EXISTS idx_assignments_student_taskno ON public.assignments (student_id, task_no);
