
-- Add session_state column to store phase/round info for resume
ALTER TABLE public.speaking_sessions ADD COLUMN IF NOT EXISTS session_state jsonb DEFAULT NULL;

-- Allow students to update their own sessions (needed for saving state on stop)
CREATE POLICY "Students can update own sessions"
ON public.speaking_sessions
FOR UPDATE
USING (student_id = auth.uid());
