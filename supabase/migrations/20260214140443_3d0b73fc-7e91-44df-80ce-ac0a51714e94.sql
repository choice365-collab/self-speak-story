
-- Create enums for difficulty and speed
CREATE TYPE public.difficulty_level AS ENUM ('low', 'medium', 'high');
CREATE TYPE public.speech_speed AS ENUM ('slow', 'medium', 'fast');

-- Add columns to profiles
ALTER TABLE public.profiles
  ADD COLUMN difficulty_level difficulty_level NOT NULL DEFAULT 'medium',
  ADD COLUMN speech_speed speech_speed NOT NULL DEFAULT 'medium';

-- Remove level column from verbs
ALTER TABLE public.verbs DROP COLUMN IF EXISTS level;
