-- Add unique constraint to prevent duplicate assignments
ALTER TABLE public.assignments ADD CONSTRAINT assignments_student_verb_unique UNIQUE (student_id, verb_id);