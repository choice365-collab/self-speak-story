import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { login_id: rawLoginId, pin, password, role } = await req.json();
    const login_id = (rawLoginId || "").toLowerCase().trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    if (role === "student") {
      // Find student by student_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, student_id, display_name")
        .ilike("student_id", login_id)
        .eq("role", "student")
        .single();

      if (profileError || !profile) {
        return new Response(JSON.stringify({ error: "Student not found" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get the auth user to check email for sign-in
      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      if (!authUser?.user) {
        return new Response(JSON.stringify({ error: "User account not found" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Simple PIN check: PIN is stored as user_metadata
      const storedPin = authUser.user.user_metadata?.pin;
      if (!storedPin || storedPin !== pin) {
        return new Response(JSON.stringify({ error: "Invalid PIN" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Sign in using the email and a generated password
      const email = authUser.user.email!;
      const originalStudentId = profile.student_id || login_id;
      const genPassword = `student_${originalStudentId}_${storedPin}`;

      // Try to sign in
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email, password: genPassword,
      });

      if (signInError) {
        return new Response(JSON.stringify({ error: "Login failed" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        session: signInData.session,
        user: signInData.user,
        profile: { role: "student", display_name: profile.display_name, student_id: profile.student_id },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } else if (role === "admin") {
      // Find admin by admin_id
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, admin_id, display_name")
        .ilike("admin_id", login_id)
        .eq("role", "admin")
        .single();

      if (profileError || !profile) {
        return new Response(JSON.stringify({ error: "Admin not found" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: authUser } = await supabase.auth.admin.getUserById(profile.id);
      if (!authUser?.user) {
        return new Response(JSON.stringify({ error: "User account not found" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const email = authUser.user.email!;
      const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email, password,
      });

      if (signInError) {
        return new Response(JSON.stringify({ error: "Invalid password" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        session: signInData.session,
        user: signInData.user,
        profile: { role: "admin", display_name: profile.display_name, admin_id: profile.admin_id },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Invalid role" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("auth-login error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
