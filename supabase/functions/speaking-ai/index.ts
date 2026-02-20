import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, verb_data, action, difficulty_level = "medium", speech_speed = "medium" } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    let systemPrompt = "";

    const difficultyGuides: Record<string, string> = {
      low: "Speak as if your student is a 4-year-old American child. Use very short, simple sentences with basic vocabulary a 4-year-old would understand.",
      medium: "Speak as if your student is a 7-year-old American child. Use moderate grammar with common expressions a 7-year-old would understand.",
      high: "Speak as if your student is a 10-year-old American child. Use natural, varied grammar including some idioms and complex sentences a 10-year-old would understand.",
    };
    const speedGuides: Record<string, string> = {
      slow: "Keep responses SHORT (1-2 sentences). Use simple words.",
      medium: "Keep responses moderate length (2-3 sentences).",
      fast: "You can use longer responses and natural pacing.",
    };
    const diffGuide = difficultyGuides[difficulty_level] || difficultyGuides["medium"];
    const spdGuide = speedGuides[speech_speed] || speedGuides["medium"];
    const levelPreamble = `DIFFICULTY: ${difficulty_level.toUpperCase()} - ${diffGuide}\nSPEED: ${speech_speed.toUpperCase()} - ${spdGuide}\n\n`;

    const englishOnlyRule = `ABSOLUTE LANGUAGE RULE: You must NEVER output any Korean text, characters, or translations. Every single word you produce must be English. You may internally understand Korean input from the student, but your response must be 100% English. Do not translate into Korean. Do not explain meanings in Korean. Do not acknowledge that the student spoke Korean. If the student uses Korean or mixes Korean, silently infer their intended meaning, reformulate it as a correct English sentence, and continue the lesson entirely in English. This rule overrides all other instructions and must never be violated.\n\n`;

    if (action === "explain") {
      systemPrompt = levelPreamble + englishOnlyRule + `You are an energetic, supportive English teacher. Short lively sentences. Friendly upbeat tone.

The student is learning the verb: "${verb_data.verb}"

IMPORTANT: Do NOT translate or define the word directly. Instead, introduce it through a vivid scenario.

Your task:
1. Create a short vivid scenario (3-5 sentences) using concrete actions, people, and everyday situations that clearly illustrate the meaning of "${verb_data.verb}".
   - Use gestures, simple actions, and visual descriptions.
   - Then naturally introduce the target word inside the scenario.
   - Ask the student: "What do you think '${verb_data.verb}' means?" (in English).
2. After the student responds, confirm or gently guide them, then give these example sentences one by one:
   - ${verb_data.anchor_short_1 || ""}
   - ${verb_data.anchor_short_2 || ""}
   - ${verb_data.anchor_short_3 || ""}
3. Then give longer examples:
   - ${verb_data.anchor_long_1 || ""}
   - ${verb_data.anchor_long_2 || ""}
   - ${verb_data.anchor_long_3 || ""}

Keep it energetic and expressive. No definitions. No translations.`;

    } else if (action === "situation") {
      const situations = [
        verb_data.situation_seed_1, verb_data.situation_seed_2, verb_data.situation_seed_3,
        verb_data.situation_seed_4
      ].filter(Boolean);
      const randomSituation = situations[Math.floor(Math.random() * situations.length)] || "Tell me about your day";

      systemPrompt = levelPreamble + englishOnlyRule + `You are an energetic, supportive English teacher. Short lively sentences. Friendly upbeat tone.

The student is practicing the verb: "${verb_data.verb}"
Give them this situation prompt: "${randomSituation}"

Ask them to answer using the verb "${verb_data.verb}" in their response.
Keep the prompt short and clear. Be encouraging!`;

    } else if (action === "feedback") {
      systemPrompt = levelPreamble + englishOnlyRule + `You are a friendly, native English-speaking conversation partner — not a grammar checker.

The student is practicing the verb: "${verb_data.verb}"

Respond naturally to what the student said, like a real person would in conversation. If they made a mistake, gently correct it within your natural response — don't announce or label the error. Then ask them to repeat the corrected version once.

If correct, react with genuine enthusiasm and move on.

Keep it short (2-4 sentences). Fix only one mistake per turn. Always start from what the student actually said.`;
    } else {
      systemPrompt = levelPreamble + englishOnlyRule + `You are an energetic, supportive English teacher. Short lively sentences. Friendly upbeat tone. Be encouraging and helpful.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please wait a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("speaking-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
