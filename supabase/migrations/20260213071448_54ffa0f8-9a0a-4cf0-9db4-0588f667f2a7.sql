
-- 1. Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'student');

-- 2. User roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. Profiles table (links auth.users to student_id or admin_id)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  display_name TEXT,
  student_id TEXT UNIQUE,
  admin_id TEXT UNIQUE,
  daily_quota_minutes INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 4. Verbs table (uploaded by admin via Excel)
CREATE TABLE public.verbs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verb TEXT NOT NULL,
  level TEXT,
  meaning_en TEXT,
  example_short_1 TEXT,
  example_short_2 TEXT,
  example_short_3 TEXT,
  example_long_1 TEXT,
  example_long_2 TEXT,
  example_long_3 TEXT,
  situation_1 TEXT,
  situation_2 TEXT,
  situation_3 TEXT,
  situation_4 TEXT,
  situation_5 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.verbs ENABLE ROW LEVEL SECURITY;

-- 5. Assignments (admin assigns verb tasks to students)
CREATE TABLE public.assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  verb_id UUID REFERENCES public.verbs(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'completed')),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  assigned_by UUID REFERENCES auth.users(id)
);
ALTER TABLE public.assignments ENABLE ROW LEVEL SECURITY;

-- 6. Speaking sessions (tracks duration per session)
CREATE TABLE public.speaking_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  assignment_id UUID REFERENCES public.assignments(id) ON DELETE CASCADE,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  session_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.speaking_sessions ENABLE ROW LEVEL SECURITY;

-- 7. Admin settings (prepaid credit balance, etc.)
CREATE TABLE public.admin_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;

-- Insert default settings
INSERT INTO public.admin_settings (key, value) VALUES 
  ('prepaid_credit_usd', '0'),
  ('student_daily_limit_minutes', '10'),
  ('admin_daily_limit_minutes', '120');

-- 8. Security definer helper: has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 9. Get user role from profiles (security definer)
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = _user_id
$$;

-- 10. RLS Policies

-- user_roles: only admins can manage, users can read own
CREATE POLICY "Users can read own role" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- profiles
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can read all profiles" ON public.profiles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert profiles" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete profiles" ON public.profiles
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- verbs
CREATE POLICY "Authenticated can read verbs" ON public.verbs
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage verbs" ON public.verbs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- assignments
CREATE POLICY "Students can read own assignments" ON public.assignments
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can update own assignments" ON public.assignments
  FOR UPDATE TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Admins can manage assignments" ON public.assignments
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- speaking_sessions
CREATE POLICY "Students can read own sessions" ON public.speaking_sessions
  FOR SELECT TO authenticated
  USING (student_id = auth.uid());

CREATE POLICY "Students can insert own sessions" ON public.speaking_sessions
  FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

CREATE POLICY "Admins can manage sessions" ON public.speaking_sessions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- admin_settings
CREATE POLICY "Admins can manage settings" ON public.admin_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated can read settings" ON public.admin_settings
  FOR SELECT TO authenticated
  USING (true);

-- 11. Auto-create profile trigger (on auth.users insert) - NOT on auth schema
-- We'll handle profile creation in the edge function instead

-- 12. Daily usage view
CREATE OR REPLACE FUNCTION public.get_daily_usage(_student_id UUID, _date DATE DEFAULT CURRENT_DATE)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(duration_seconds), 0)::INTEGER
  FROM public.speaking_sessions
  WHERE student_id = _student_id AND session_date = _date
$$;
