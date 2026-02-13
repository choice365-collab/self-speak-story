
-- Add FK from assignments.student_id to profiles.id
ALTER TABLE public.assignments 
ADD CONSTRAINT assignments_student_id_profiles_fkey 
FOREIGN KEY (student_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- Create practice_logs table
CREATE TABLE public.practice_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  assignment_id uuid REFERENCES public.assignments(id) ON DELETE CASCADE,
  situation_index integer NOT NULL DEFAULT 1,
  attempt_no integer NOT NULL DEFAULT 1,
  student_transcript text,
  ai_feedback text,
  result text NOT NULL DEFAULT 'fail',
  audio_seconds integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.practice_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students can read own logs" ON public.practice_logs FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students can insert own logs" ON public.practice_logs FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Admins can manage logs" ON public.practice_logs FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Create daily_usage table
CREATE TABLE public.daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  used_seconds integer NOT NULL DEFAULT 0,
  limit_seconds integer NOT NULL DEFAULT 600,
  UNIQUE(student_id, date)
);
ALTER TABLE public.daily_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Students can read own usage" ON public.daily_usage FOR SELECT USING (student_id = auth.uid());
CREATE POLICY "Students can upsert own usage" ON public.daily_usage FOR INSERT WITH CHECK (student_id = auth.uid());
CREATE POLICY "Students can update own usage" ON public.daily_usage FOR UPDATE USING (student_id = auth.uid());
CREATE POLICY "Admins can manage usage" ON public.daily_usage FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- Create credit_balance table (single row)
CREATE TABLE public.credit_balance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  balance_usd numeric(10,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_balance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage credit_balance" ON public.credit_balance FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can read credit_balance" ON public.credit_balance FOR SELECT USING (true);
INSERT INTO public.credit_balance (balance_usd) VALUES (0);

-- Create credit_events table
CREATE TABLE public.credit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'adjust',
  amount_usd numeric(10,2) NOT NULL DEFAULT 0,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.credit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can manage credit_events" ON public.credit_events FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Authenticated can read credit_events" ON public.credit_events FOR SELECT USING (true);
