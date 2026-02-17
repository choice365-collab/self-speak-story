import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const { transcripts } = await req.json();
    if (!transcripts || transcripts.length === 0) {
      return new Response(JSON.stringify({ expressions: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build conversation text for AI analysis
    const conversationText = transcripts
      .map((t: { role: string; text: string }) => `${t.role === "user" ? "Student" : "AI"}: ${t.text}`)
      .join("\n");

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `You are an English learning analyst. Given a conversation between a student and an AI English teacher, extract the English expressions that were taught/practiced.

Return a JSON array of objects. Each object has:
- "expression": the English word or phrase taught (string)
- "explanation": a brief English explanation of the expression (1-2 sentences)
- "examples": an array of 2-3 example sentences using the expression

Only include expressions that were actively discussed or practiced. If none were taught, return an empty array.
Return ONLY the JSON array, no markdown or extra text.`,
          },
          {
            role: "user",
            content: conversationText,
          },
        ],
        temperature: 0.3,
      }),
    });

    if (!aiRes.ok) throw new Error("AI extraction failed");

    const aiData = await aiRes.json();
    const rawContent = aiData.choices?.[0]?.message?.content || "[]";

    let expressions;
    try {
      // Strip markdown code blocks if present
      const cleaned = rawContent.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      expressions = JSON.parse(cleaned);
    } catch {
      expressions = [];
    }

    // Save to learning_history
    if (expressions.length > 0) {
      const rows = expressions.map((exp: { expression: string; explanation: string; examples: string[] }) => ({
        student_id: user.id,
        expression: exp.expression,
        ai_explanation: exp.explanation,
        example_sentences: exp.examples || [],
      }));

      const { error: insertError } = await supabase.from("learning_history").insert(rows);
      if (insertError) console.error("Insert error:", insertError);
    }

    return new Response(JSON.stringify({ expressions }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-expressions error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
