
-- Add completed_count and last_completed_score to assignments
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS completed_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.assignments ADD COLUMN IF NOT EXISTS last_completed_score integer DEFAULT NULL;

-- Add score column to practice_logs
ALTER TABLE public.practice_logs ADD COLUMN IF NOT EXISTS score integer DEFAULT NULL;
