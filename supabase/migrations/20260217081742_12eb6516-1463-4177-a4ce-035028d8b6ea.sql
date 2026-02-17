
-- Learning history: stores expressions learned during free chat sessions
CREATE TABLE public.learning_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  student_id UUID NOT NULL,
  expression TEXT NOT NULL,
  ai_explanation TEXT,
  example_sentences TEXT[],
  learned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  session_date DATE NOT NULL DEFAULT CURRENT_DATE
);

ALTER TABLE public.learning_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Students can read own history"
  ON public.learning_history FOR SELECT
  USING (student_id = auth.uid());

CREATE POLICY "Students can insert own history"
  ON public.learning_history FOR INSERT
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Admins can manage history"
  ON public.learning_history FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_learning_history_student_date ON public.learning_history(student_id, session_date);
