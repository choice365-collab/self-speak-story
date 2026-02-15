import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Verify the caller is an admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No auth header" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user: caller } } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check caller is admin
    const { data: callerProfile } = await supabase
      .from("profiles").select("role").eq("id", caller.id).single();
    if (!callerProfile || callerProfile.role !== "admin") {
      return new Response(JSON.stringify({ error: "Admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle PUT for updating existing student (PIN change)
    if (req.method === "PUT") {
      const { user_id, pin, student_id } = await req.json();
      if (!user_id || !pin || pin.length !== 4) {
        return new Response(JSON.stringify({ error: "user_id and 4-digit pin required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const newPassword = `student_${student_id}_${pin}`;
      const { error: updateError } = await supabase.auth.admin.updateUserById(user_id, {
        password: newPassword,
        user_metadata: { pin },
      });

      if (updateError) {
        return new Response(JSON.stringify({ error: updateError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { role, login_id, pin, password, display_name, daily_quota_minutes, difficulty_level, speech_speed } = await req.json();

    if (role === "student") {
      const email = `student_${login_id}@speakbyyourself.app`;
      const genPassword = `student_${login_id}_${pin}`;

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password: genPassword,
        email_confirm: true,
        user_metadata: { pin, role: "student", student_id: login_id },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("profiles").insert({
        id: newUser.user.id,
        role: "student",
        student_id: login_id,
        display_name: display_name || login_id,
        daily_quota_minutes: daily_quota_minutes || 60,
        difficulty_level: difficulty_level || "medium",
        speech_speed: speech_speed || "medium",
      });

      await supabase.from("user_roles").insert({
        user_id: newUser.user.id,
        role: "student",
      });

      // Auto-assign all active verbs
      const { data: allVerbs } = await supabase
        .from("verbs")
        .select("id, verb_no")
        .eq("is_active", true)
        .order("verb_no", { ascending: true });
      if (allVerbs && allVerbs.length > 0) {
        const assignmentRows = allVerbs.map((v: any) => ({
          student_id: newUser.user.id,
          verb_id: v.id,
          assigned_by: caller.id,
          task_no: v.verb_no,
        }));
        await supabase.from("assignments").insert(assignmentRows);
      }

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else if (role === "admin") {
      const email = `admin_${login_id}@speakbyyourself.app`;

      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "admin", admin_id: login_id },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: createError.message }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabase.from("profiles").insert({
        id: newUser.user.id,
        role: "admin",
        admin_id: login_id,
        display_name: display_name || login_id,
        daily_quota_minutes: 120,
      });

      await supabase.from("user_roles").insert({
        user_id: newUser.user.id,
        role: "admin",
      });

      return new Response(JSON.stringify({ success: true, user_id: newUser.user.id }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid role" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("create-user error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
