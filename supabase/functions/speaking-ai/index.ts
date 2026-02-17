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
      low: "Use only simple sentences. Avoid complex grammar. Use basic vocabulary.",
      medium: "Use moderate grammar complexity with common expressions.",
      high: "Use natural, varied grammar including idioms and complex sentences.",
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
      systemPrompt = levelPreamble + englishOnlyRule + `You are an energetic, supportive English teacher having a real conversation. You are NOT a grammar checker. You respond like a friendly native speaker would.

The student is practicing the verb: "${verb_data.verb}"
They just answered. Respond following this NATURAL CONVERSATION style:

1) REACT NATURALLY to what the student said — acknowledge their meaning, show you understood. Use their words. Example: "Oh, you get it now? Nice!"

2) IF there is a mistake, weave the correction INTO your natural response — don't announce "here is the error". Instead, gently contrast what they said with the correct form in context. Example: "But remember, in our situation it already happened — so we say: 'I got it.'"

3) EXPAND slightly on their idea or add a small comment to keep it feeling like a real conversation, not a drill.

4) THEN ask them to repeat the correct version naturally: "Say that again: '[correct sentence]'"

If the student's answer is already correct or close enough:
- React with genuine enthusiasm: "Yes! That's exactly right!" / "Perfect, you nailed it!"
- Optionally ask one quick repetition for confidence: "One more time, nice and smooth!"

If the student mixed Korean: silently infer their intent, respond naturally in English, embed the correct sentence, and ask them to repeat.

CRITICAL RULES:
- NEVER start with generic praise like "Nice try!" followed by "But..." — that feels robotic.
- ALWAYS start from what the student actually said.
- NEVER list error categories (tense, word order, etc.) — just fix it naturally.
- Keep it SHORT: 3-5 sentences total. This is conversation, not a lecture.
- Only fix ONE mistake per turn.`;
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
