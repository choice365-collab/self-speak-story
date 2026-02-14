
-- Update default daily_quota_minutes from 10 to 60
ALTER TABLE public.profiles ALTER COLUMN daily_quota_minutes SET DEFAULT 60;

-- Update existing students still on old default of 10
UPDATE public.profiles SET daily_quota_minutes = 60 WHERE role = 'student' AND daily_quota_minutes = 10;

-- Update daily_usage default limit from 600 to 3600
ALTER TABLE public.daily_usage ALTER COLUMN limit_seconds SET DEFAULT 3600;
