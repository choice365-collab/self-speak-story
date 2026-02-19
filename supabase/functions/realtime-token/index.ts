import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY is not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { model = "gpt-4o-mini-realtime-preview", voice = "alloy", instructions, turn_detection, input_audio_transcription, speed } = await req.json().catch(() => ({}));

    // Map speed label to OpenAI speed value (0.7 ~ 1.3)
    const speedMap: Record<string, number> = { slow: 0.8, medium: 1.0, fast: 1.2 };
    const speedValue = speedMap[speed] ?? 1.0;

    const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        voice,
        speed: speedValue,
        modalities: ["audio", "text"],
        ...(instructions ? { instructions } : {}),
        ...(turn_detection ? { turn_detection } : {}),
        ...(input_audio_transcription ? { input_audio_transcription } : {}),
        output_audio_format: "pcm16",
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI Realtime session error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Failed to create realtime session", status: response.status }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await response.json();

    return new Response(JSON.stringify(session), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("realtime-token error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
