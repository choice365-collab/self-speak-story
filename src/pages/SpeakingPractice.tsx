import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mic, MicOff, PhoneOff, CheckCircle, History, Captions, CaptionsOff } from "lucide-react";
import { formatVerbKey } from "@/lib/formatVerbKey";
import { type CorrectionEntry } from "@/lib/evaluateAttempt";
import { useRealtimeWebRTC, type TranscriptEntry } from "@/hooks/useRealtimeWebRTC";
import TranscriptReport from "@/components/TranscriptReport";

// ── Types ──

type VerbData = {
  verb_key: string;
  base_verb: string;
  meaning_en: string | null;
  anchor_short_1: string | null;
  anchor_short_2: string | null;
  anchor_short_3: string | null;
  anchor_long_1: string | null;
  anchor_long_2: string | null;
  anchor_long_3: string | null;
  situation_seed_1: string | null;
  situation_seed_2: string | null;
  situation_seed_3: string | null;
  situation_seed_4: string | null;
};

function containsKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

/** Renders text with quoted phrases highlighted and Korean hints styled */
function HighlightedText({ text }: { text: string }) {
  // Match: "quoted text" optionally followed by (Korean hint)
  const parts = text.split(/(".*?"(?:\s*\([^)]*\))?)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^(".*?")(\s*\(([^)]*)\))?$/);
        if (match) {
          return (
            <span key={i}>
              <span className="text-primary font-bold">{match[1]}</span>
              {match[2] && (
                <span className="text-muted-foreground text-sm font-semibold">{" "}({match[3]})</span>
              )}
            </span>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── System instructions builder ──

// Round counts per phase — easy to adjust later
const SHORT_ROUNDS = 2;
const LONG_ROUNDS = 2;
const SITUATION_ROUNDS = 2;

function buildSystemInstructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const shortExamples = [verb.anchor_short_1, verb.anchor_short_2, verb.anchor_short_3].filter(Boolean);
  const longExamples = [verb.anchor_long_1, verb.anchor_long_2, verb.anchor_long_3].filter(Boolean);
  const situations = [verb.situation_seed_1, verb.situation_seed_2, verb.situation_seed_3, verb.situation_seed_4].filter(Boolean);

  const shortList = shortExamples.map((e, i) => "  " + (i + 1) + '. "' + e + '"').join("\n");
  const longList = longExamples.map((e, i) => "  " + (i + 1) + '. "' + e + '"').join("\n");
  const sitList = situations.map((s, i) => "  " + (i + 1) + ". " + s).join("\n");

  const worldContext = "WORLD CONTEXT: Your student lives in a child's world. Use vocabulary and scenarios from: playing with friends, animals, pets, toys, food (snacks, lunch, dinner), family, school life, playground, singing, drawing, sleeping, running, jumping, hiding, hobbies, sports, travel, holidays. AVOID: work, meetings, business, driving, money, office, schedules, appointments, commuting, or any adult-life vocabulary.";

  const difficultyGuides: Record<string, string> = {
    low: "Speak as if your student is a 4-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 4-year-old would understand. " + worldContext,
    medium: "Speak as if your student is a 7-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 7-year-old would understand. " + worldContext,
    high: "Speak as if your student is a 10-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 10-year-old would understand.",
  };

  const speedGuides: Record<string, string> = {
    slow: "Keep each turn to 1-2 short sentences. Speak clearly. Give the student plenty of time.",
    medium: "Keep each turn to 2-3 sentences. Speak at a comfortable pace.",
    fast: "You can use 3-4 sentences per turn. Speak naturally.",
  };

  const koreanHintRule = '\nKOREAN TRANSLATION: The FIRST time you introduce each target sentence, say its Korean meaning once right after. Example: "I got back home — 집에 돌아왔어." Do NOT repeat the Korean for the same sentence again in later rounds. Only translate target practice sentences, not your general speech.';

  return [
    "You are an energetic, friendly native English teacher having a fun 1-on-1 conversation with a young student.",
    "Speak naturally — like a real person, not a textbook. Be warm, encouraging, and expressive.",
    "",
    "LANGUAGE: English only. If the student speaks Korean, infer their meaning and continue naturally in English.",
    "",
    "VOCABULARY/GRAMMAR: " + (difficultyGuides[difficultyLevel] || difficultyGuides["medium"]),
    "TURN LENGTH: " + (speedGuides[speechSpeed] || speedGuides["medium"]),
    "",
    'TARGET VERB: "' + verb.base_verb + '"',
    "",
    "═══ LESSON STRUCTURE (3 Phases) ═══",
    "",
    "You MUST follow these 3 phases IN ORDER. Do NOT skip ahead.",
    "",
    "────── PHASE 1: SHORT SENTENCES (" + SHORT_ROUNDS + " rounds) ──────",
    "Short sentence targets:",
    shortList,
    "",
    "── Round 1 steps:",
    "1. Pick one short sentence from the list above.",
    '2. Say the sentence naturally. Then IMMEDIATELY say its Korean meaning out loud. Format: "[English sentence] — [accurate Korean translation]". You MUST translate the actual target sentence correctly. This Korean translation is MANDATORY.',
    "3. Explain what it means in a simple, fun way (NO technical words like 'tense', 'grammar', 'verb form').",
    "4. Create a quick, relatable situation where the student would use this sentence. NEVER use the same scenario opening twice in a row. Vary your openings naturally using expressions such as (but not limited to): 'Let's say...', 'If you...', 'Suppose...', 'You're at...', 'Think about this...', 'Picture this...', 'Here's a situation...'.",
    '5. Prompt the student to say the ORIGINAL sentence using IMPERATIVE/DECLARATIVE forms ONLY (e.g. "Say, \'He has a dog.\'", "Try this one.", "Now say it."). NEVER use question forms like "Can you say...?".',
    "6. If correct → react with genuine enthusiasm (vary your reactions) and move on to the 'already happened' step.",
    "7. If wrong → correct naturally, model the right sentence, and invite them to try again. Once correct, move to the 'already happened' step.",
    "8. 'AS IF IT ALREADY HAPPENED' (MANDATORY in Round 1): AFTER the student successfully says the original sentence: (A) If the target sentence can naturally be said as if it already happened (e.g., 'I have a plan' → 'I had a plan'), convert it directly and include what it means in Korean. Ask the student to say it once. Do NOT correct — just say 'Good try!' or similar and move on. (B) If the target is a command, greeting, or fixed phrase (e.g., 'Have a seat', 'Let me know'), do NOT force a direct conversion. Instead, give a new natural sentence using the same key word as if it already happened (e.g., 'I had a seat by the window') with what it means in Korean. Ask the student to say it once. Do NOT correct — just say 'Good try!' or similar and move on.",
    "",
    "── Round 2 steps:",
    "1. Pick a DIFFERENT short sentence from the list.",
    '2. Say the sentence naturally with Korean translation.',
    "3. Explain what it means simply.",
    "4. Create a situation. (NO 'already happened' version in Round 2.)",
    '5. Prompt the student to say it (imperative/declarative only).',
    "6. If correct → praise and move on. If wrong → correct and retry.",
    "After " + SHORT_ROUNDS + " short sentences, move to Phase 2.",
    "",
    "────── PHASE 2: LONG SENTENCES (" + LONG_ROUNDS + " rounds) ──────",
    "Long sentence targets:",
    longList,
    "",
    "QUESTION FORM RULE FOR PHASE 2: In Round 1, you MUST turn the target sentence into a question (e.g., 'I had a great time' → 'Did you have a great time?'). In Round 2, use the original sentence as-is.",
    "",
    "For each round:",
    "1. Pick one long sentence from the list above.",
    '2. Say the sentence naturally (question form in Round 1, statement in Round 2). Then IMMEDIATELY say its Korean meaning out loud. Format: "[English sentence] — [accurate Korean translation]". You MUST translate the actual target sentence correctly. This Korean translation is MANDATORY for every new sentence.',
    "3. Explain what it means simply.",
    "4. Create a situation where the student would use this sentence.",
    '5. Prompt the student to say it using IMPERATIVE/DECLARATIVE forms ONLY (e.g. "Say, \'I have a bad cold.\'", "Try this one.", "Now say it.", "Your turn."). NEVER use question forms like "Can you say...?" or "Could you try...?" — questions cause students to copy rising intonation.',
    "6. If correct → react with genuine enthusiasm (vary your reactions) and move on.",
    "7. If wrong → correct naturally within conversation, model the right sentence, and invite them to try again.",
    "After " + LONG_ROUNDS + " long sentences, move to Phase 3.",
    "",
    "────── PHASE 3: FREE SITUATIONS (" + SITUATION_ROUNDS + " rounds) ──────",
    "Situation seeds (expand these into vivid, detailed scenarios):",
    sitList,
    "",
    "TARGET SENTENCES THE STUDENT LEARNED (use these as building blocks in situations):",
    shortList,
    longList,
    "",
    "GOAL OF PHASE 3: Help the student BUILD THEIR OWN sentence using the target verb through a Korean-first scaffolding process. This phase is COMPLETELY DIFFERENT from Phases 1 & 2. The student thinks in Korean first, then constructs in English.",
    "",
    "LANGUAGE EXCEPTION FOR PHASE 3 ONLY: You ARE allowed to speak Korean in Step 1. All other steps MUST be in English.",
    "",
    "QUESTION FORM RULE FOR PHASE 3: In Round 1, design the situation so the student naturally needs to ASK A QUESTION. In Round 2, use a normal statement-form situation.",
    "",
    "For each round, follow these steps IN ORDER — do NOT skip any step:",
    "",
    "STEP 1 — KOREAN SITUATION + QUESTION (speak ENTIRELY in Korean):",
    "   Pick a situation seed and describe a fun, relatable scenario ENTIRELY IN KOREAN.",
    "   Then ask the student IN KOREAN: '너라면 뭐라고 말할 것 같아?' or '이런 상황에서 뭐라고 하면 좋을까?'",
    "   Example: '자, 지금 네가 친구랑 공원에 있어. 친구가 뭐 하고 싶냐고 물어봐. 너라면 뭐라고 말할 것 같아?'",
    "   IMPORTANT: Do NOT say the situation in English first. Start directly in Korean.",
    "   WAIT for the student to answer. They will likely answer in Korean.",
    "",
    "STEP 2 — ACKNOWLEDGE KOREAN ANSWER + ENGLISH HINT (switch to English):",
    "   Acknowledge what the student said positively in English: 'Oh, that\\'s a great idea!'",
    "   Then give an English HINT using the target verb, but NEVER give the full sentence.",
    "   - Say something like: 'Nice! Now try saying that in English. Use the word \\'" + verb.base_verb + "\\'... what would you say?'",
    "   - Or: 'Good thinking! Can you say it in English? Start with \\'I " + verb.base_verb + "...\\'",
    "   - NEVER say the complete sentence for them. This is FORBIDDEN.",
    "   WAIT for the student to try in English.",
    "",
    "STEP 3 — CORRECT AND POLISH (English only):",
    "   A) If good: 'That\\'s great! Just a tiny bit better:' → give polished version as standalone sentence → ask them to say it one time.",
    "   B) If partial: 'Almost! You said ___' (quote ONLY what they actually said) → show the better version as standalone sentence → ask them to try again.",
    "   C) If silence or no English: 'Go ahead, try it in English! Use \\'" + verb.base_verb + "\\'...'",
    "   D) After 2 failed attempts: Then and ONLY then, model the full sentence and ask them to say it once.",
    "",
    "STEP 4 — FINAL REPEAT (English only):",
    "   Once the student produces a good sentence, have them say it ONE more time clearly. Then praise and move on.",
    "",
    "After " + SITUATION_ROUNDS + ' situations, say "PRACTICE COMPLETE!" to end the lesson.',
    "",
    "═══ RULES ═══",
    "• SILENCE vs ATTEMPT RULE (ALL PHASES):",
    "  TIER 1 — GOOD ATTEMPT: The student said most key words of the target sentence clearly. → Praise and move on.",
    "  TIER 2 — PARTIAL ATTEMPT: The student said some words but the sentence is clearly incomplete or has significant errors. → Say 'Almost!' or 'So close!', then say 'Listen again:' and model the full correct sentence. Ask them to try one more time. Do NOT pretend they said it correctly.",
    "  TIER 3 — SILENCE / NO MEANINGFUL SPEECH: Nothing meaningful heard (background noise, breathing, random sounds). → Say 'I didn\\'t hear you — go ahead, try it!' Do NOT pretend they spoke.",
    "• NO-FABRICATION RULE: When referencing what the student said (e.g. 'You said ___'), ONLY quote words the student ACTUALLY spoke. NEVER add, complete, or fill in words they did not say. If the student said 'I go', do NOT quote them as 'I go to the park.' Instead: 'You said I go — almost! Try the whole thing:' then model the correct sentence.",
    "• QUOTED QUESTION PLACEMENT: When you quote a student's sentence that ends with a question mark, ALWAYS place that quoted sentence at the VERY END of your turn so the voice engine reads it with proper rising intonation. BAD: 'You said, \"Do you have a plan?\" Great job!' GOOD: 'Great job! You said, \"Do you have a plan?\"'",
    koreanHintRule,
    "• QUESTION INTONATION RULE: When you ask a question, it MUST be a SHORT, STANDALONE sentence — never embedded inside a longer sentence. Break it out on its own so the voice engine reads it with proper rising intonation. BAD: 'Now I want you to think about what you would say if someone asked you do you have any pizza?' GOOD: 'Imagine you\\'re at a pizza shop. The worker looks at you. What would you say?' Keep each question under 10 words when possible.",
    "• MODEL SENTENCE FRAMING RULE: When presenting a sentence for the student to repeat, NEVER use colons or quotation marks to frame it (the voice engine reads quoted text as reported speech with flat intonation). Instead, end your instruction as a complete sentence with a period, then say the model sentence as a SEPARATE STANDALONE sentence. BAD: 'Now, go ahead and say it: \"Can I have a seat?\"' GOOD: 'Now it\\'s your turn. Can I have a seat?' This is especially critical for questions — they must stand alone so the voice engine applies rising intonation.",
    "• Always create a situation FIRST, then let them try. Never just say 'Repeat after me.'",
    "• When creating a situation, match WHO the student would say the sentence to. If the target sentence is advice to someone else, put a friend/family member in the scene. If it's something you'd say to yourself, set a solo scenario. The listener must fit the sentence.",
    "• Fix only ONE mistake per turn. Keep corrections brief and natural.",
    "• Don't repeat yourself. If you already explained something, move forward.",
    "• When the student interrupts (barge-in), stop and listen. After they finish, repeat the same sentence you were saying from the beginning before moving on. Do not skip it or move to the next instruction.",
    "• PHASE TRANSITION: When transitioning between phases, announce the transition AND immediately start the first sentence of the new phase in the SAME turn. Do NOT pause or wait for the student's response. Example: 'Great! Now let\\'s try some longer sentences! This time, I want you to say…' — all in one breath.",
    "• Vary your wording every turn. Never start two consecutive turns the same way.",
    "• PRAISE TIMING RULE: NEVER use praise or encouragement (great job, good try, awesome, nice, exactly, etc.) unless you are directly responding to something the student just said. Do not use praise as a filler or transition between your own sentences. Praise must only appear as the FIRST reaction after a student utterance.",
    "• Use diverse praise — never repeat the same one back-to-back.",
    "• Rephrase your prompts creatively each time — but ALWAYS use imperative/declarative forms, NEVER questions, when asking the student to speak.",
    "• Sound like a real person, not a script. Surprise the student with your energy and creativity.",
  ].filter(Boolean).join("\n");
}

/** Phase 3-only instructions — sent via session.update when Phase 3 is detected */
function buildPhase3Instructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const situations = [verb.situation_seed_1, verb.situation_seed_2, verb.situation_seed_3, verb.situation_seed_4].filter(Boolean);
  const sitList = situations.map((s, i) => "  " + (i + 1) + ". " + s).join("\n");
  const shortExamples = [verb.anchor_short_1, verb.anchor_short_2, verb.anchor_short_3].filter(Boolean);
  const longExamples = [verb.anchor_long_1, verb.anchor_long_2, verb.anchor_long_3].filter(Boolean);
  const shortList = shortExamples.map((e, i) => "  " + (i + 1) + '. "' + e + '"').join("\n");
  const longList = longExamples.map((e, i) => "  " + (i + 1) + '. "' + e + '"').join("\n");

  const worldContext = "WORLD CONTEXT: Your student lives in a child's world. Use vocabulary and scenarios from: playing with friends, animals, pets, toys, food (snacks, lunch, dinner), family, school life, playground, singing, drawing, sleeping, running, jumping, hiding, hobbies, sports, travel, holidays. AVOID: work, meetings, business, driving, money, office, schedules, appointments, commuting, or any adult-life vocabulary.";
  const difficultyGuides: Record<string, string> = {
    low: "Speak as if your student is a 4-year-old American child. " + worldContext,
    medium: "Speak as if your student is a 7-year-old American child. " + worldContext,
    high: "Speak as if your student is a 10-year-old American child.",
  };
  const speedGuides: Record<string, string> = {
    slow: "Keep each turn to 1-2 short sentences.",
    medium: "Keep each turn to 2-3 sentences.",
    fast: "You can use 3-4 sentences per turn.",
  };

  return [
    "You are an energetic, friendly native English teacher. You just finished teaching short and long sentences with the verb \"" + verb.base_verb + "\".",
    "Now you are in PHASE 3: FREE SITUATIONS. This is a COMPLETELY DIFFERENT phase.",
    "",
    "VOCABULARY/GRAMMAR: " + (difficultyGuides[difficultyLevel] || difficultyGuides["medium"]),
    "TURN LENGTH: " + (speedGuides[speechSpeed] || speedGuides["medium"]),
    "",
    "Situation seeds:",
    sitList,
    "",
    "TARGET SENTENCES THE STUDENT LEARNED (use as building blocks):",
    shortList,
    longList,
    "",
    "GOAL: Help the student BUILD THEIR OWN sentence using \"" + verb.base_verb + "\" through a Korean-first scaffolding process.",
    "The student thinks in Korean first, then constructs in English.",
    "",
    "You must do 2 situation rounds. For each round, follow these steps STRICTLY in order:",
    "",
    "STEP 1 — KOREAN SITUATION + QUESTION (speak ENTIRELY in Korean):",
    "   Pick a situation seed and describe a fun scenario ENTIRELY IN KOREAN.",
    "   Then ask IN KOREAN: '너라면 뭐라고 말할 것 같아?' or '이런 상황에서 뭐라고 하면 좋을까?'",
    "   Example: '자, 지금 네가 저녁을 먹고 있는데, 브로콜리가 나왔어. 너는 브로콜리가 너무 싫어! 너라면 뭐라고 말할 것 같아?'",
    "   CRITICAL: Do NOT say ANYTHING in English in Step 1. The ENTIRE step must be Korean.",
    "   WAIT for the student to answer (they will answer in Korean).",
    "",
    "STEP 2 — ACKNOWLEDGE + ENGLISH HINT (switch to English):",
    "   Acknowledge what the student said in English: 'Oh, that's a great idea!'",
    "   Give an English HINT using '" + verb.base_verb + "', but NEVER give the full sentence.",
    "   Say: 'Now try saying that in English! Use the word \"" + verb.base_verb + "\"... what would you say?'",
    "   Or: 'Start with \"" + verb.base_verb + " it...\" and tell me!'",
    "   FORBIDDEN: Never say the complete English sentence for them.",
    "   WAIT for the student to try in English.",
    "",
    "STEP 3 — CORRECT AND POLISH (English only):",
    "   If good: 'That's great! Just a tiny bit better:' → give polished version → ask them to say it once.",
    "   If partial: 'Almost! You said ___' (quote ONLY actual words) → show better version → try again.",
    "   If silence: 'Go ahead, try it in English! Use \"" + verb.base_verb + "\"...'",
    "   After 2 failed attempts: Model the full sentence and ask them to say it once.",
    "",
    "STEP 4 — FINAL REPEAT (English only):",
    "   Have them say it ONE more time clearly. Praise and move on.",
    "",
    "After 2 situations, say \"PRACTICE COMPLETE!\" to end.",
    "",
    "RULES:",
    "• Step 1 is the ONLY step where you speak Korean. Steps 2-4 must be entirely English.",
    "• NEVER give the full English answer in Step 2. Hints only!",
    "• When quoting what the student said, only quote their ACTUAL words.",
    "• Keep maximum 2 sentences per turn.",
    "• Start Round 1 NOW by describing a situation in Korean.",
    "",
    "═══ COMMON RULES (apply at all times) ═══",
    "• SILENCE vs ATTEMPT RULE:",
    "  TIER 1 — GOOD ATTEMPT: Student said most key words clearly. → Praise and move on.",
    "  TIER 2 — PARTIAL ATTEMPT: Some words but incomplete/errors. → 'Almost!' + model correct sentence + retry.",
    "  TIER 3 — SILENCE / NO MEANINGFUL SPEECH: Nothing meaningful heard. → 'I didn\\'t hear you — go ahead, try it!' Do NOT pretend they spoke.",
    "• NO-FABRICATION RULE: When referencing what the student said ('You said ___'), ONLY quote words they ACTUALLY spoke. NEVER add or complete words they didn\\'t say.",
    "• QUOTED QUESTION PLACEMENT: Quoted sentences ending with '?' must be placed at the VERY END of your turn for proper TTS intonation.",
    "• MODEL SENTENCE FRAMING RULE: Never use colons/quotation marks to frame model sentences. End instruction with a period, then say the model sentence as a SEPARATE STANDALONE sentence.",
    "• PRAISE TIMING RULE: NEVER use praise unless directly responding to something the student just said.",
    "• Fix only ONE mistake per turn. Keep corrections brief.",
    "• When the student interrupts (barge-in), stop and listen. After they finish, repeat the same sentence from the beginning.",
  ].join("\n");
}

// ── Component ──

export default function SpeakingPractice() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  // Data
  const [verbData, setVerbData] = useState<VerbData | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [userMuted, setUserMuted] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [correctionHistory, setCorrectionHistory] = useState<CorrectionEntry[]>(() => {
    try {
      const stored = localStorage.getItem("corrections_" + assignmentId);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const totalAudioSecondsRef = useRef(0);
  const sessionStartRef = useRef(Date.now());
  const userMutedRef = useRef(false);
  const streamingTextRef = useRef("");
  const userTranscriptsRef = useRef<string[]>([]);
  const aiTranscriptsRef = useRef<string[]>([]);
  const conversationLogRef = useRef<{ role: string; text: string; ts: number }[]>([]);
  const currentSessionIdRef = useRef<string | null>(null);
  const previousConversationLogRef = useRef<{ role: string; text: string; ts: number }[]>([]);
  const firstDeltaTimeRef = useRef(0);
  const [aiStreamActive, setAiStreamActive] = useState(false);
  const aiStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hook
  const {
    status: connectionState,
    error,
    isAiSpeaking,
    connect,
    disconnect,
    setMicEnabled,
    sendUserText,
    sendSessionUpdate,
  } = useRealtimeWebRTC();

  const phase3UpdatedRef = useRef(false);

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";
  // AI is "speaking" if hook says so OR if text deltas are actively streaming
  const teacherActive = isAiSpeaking || aiStreamActive;

  // ── Side effects ──

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, streamingText]);

  useEffect(() => {
    loadAssignment();
    return () => {
      disconnect();
      if (autoExitTimerRef.current) clearTimeout(autoExitTimerRef.current);
    };
  }, [assignmentId]);

  // ── Data helpers ──

  const checkDailyLimit = async (): Promise<boolean> => {
    if (!user) return true;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("daily_usage")
      .select("used_seconds, limit_seconds")
      .eq("student_id", user.id)
      .eq("date", today)
      .maybeSingle();
    if (data && data.used_seconds >= data.limit_seconds) {
      setIsBlocked(true);
      return true;
    }
    return false;
  };

  const loadAssignment = async () => {
    if (!assignmentId) return;
    const blocked = await checkDailyLimit();
    if (blocked) { toast.error("Daily limit reached. Try again tomorrow!"); return; }
    const { data } = await supabase.from("assignments").select("*, verbs(*)").eq("id", assignmentId).single();
    if (data?.verbs) {
      setVerbData(data.verbs as any);
      await supabase.from("assignments").update({ status: "in_progress" }).eq("id", assignmentId);
    }
  };

  const updateDailyUsage = async (addSeconds: number) => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const limitSeconds = (profile?.daily_quota_minutes || 60) * 60;
    const { data: existing } = await supabase
      .from("daily_usage").select("id, used_seconds").eq("student_id", user.id).eq("date", today).maybeSingle();
    if (existing) {
      const newUsed = existing.used_seconds + addSeconds;
      await supabase.from("daily_usage").update({ used_seconds: newUsed }).eq("id", existing.id);
      if (newUsed >= limitSeconds) setIsBlocked(true);
    } else {
      await supabase.from("daily_usage").insert({ student_id: user.id, date: today, used_seconds: addSeconds, limit_seconds: limitSeconds });
    }
  };

  const addCorrection = useCallback((entry: CorrectionEntry) => {
    setCorrectionHistory((prev) => {
      const updated = [...prev, entry];
      try { localStorage.setItem("corrections_" + assignmentId, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [assignmentId]);

  // ── Callbacks ──

  // Use ref for handleCompletion to avoid stale closures in callbacks
  const handleCompletionRef = useRef<() => void>(() => {});
  const completionTriggeredRef = useRef(false);

  // Update ref whenever handleCompletion changes (it captures user, assignmentId, etc.)
  useEffect(() => {
    handleCompletionRef.current = () => {
      if (completionTriggeredRef.current) return; // prevent double-trigger
      completionTriggeredRef.current = true;
      handleCompletion();
    };
  });

  const checkForCompletion = useCallback((text: string) => {
    if (completionTriggeredRef.current) return;
    const upper = text.toUpperCase();
    if (
      upper.includes("PRACTICE COMPLETE") ||
      upper.includes("LESSON COMPLETE") ||
      upper.includes("PRACTICE IS COMPLETE") ||
      upper.includes("LESSON IS COMPLETE") ||
      (upper.includes("COMPLETE") && (upper.includes("GREAT JOB") || upper.includes("WELL DONE") || upper.includes("AMAZING")))
    ) {
      console.log("[completion] Detected completion phrase in:", text.slice(-80));
      handleCompletionRef.current();
    }
  }, []);

  const handleAiTextDelta = useCallback((delta: string) => {
    streamingTextRef.current += delta;
    setStreamingText(streamingTextRef.current);
    if (!firstDeltaTimeRef.current) firstDeltaTimeRef.current = Date.now();
    // Cancel any pending "stream done" timer — AI is still generating
    if (aiStreamTimerRef.current) { clearTimeout(aiStreamTimerRef.current); aiStreamTimerRef.current = null; }
    setAiStreamActive(true);
    // Backup detection: check streaming text even before done event
    checkForCompletion(streamingTextRef.current);
  }, [checkForCompletion]);

  const handleAiTranscriptDone = useCallback((text: string) => {
    // Estimate remaining audio playback time from word count
    // OpenAI TTS speaks at ~2.5 words/sec; text generation is faster than audio
    const wordCount = text.split(/\s+/).length;
    const estimatedAudioMs = (wordCount / 2.5) * 1000;
    const textGenMs = Date.now() - (firstDeltaTimeRef.current || Date.now());
    const remainingMs = Math.max(500, estimatedAudioMs - textGenMs);
    firstDeltaTimeRef.current = 0; // reset for next response
    console.log(`[audio-estimate] words=${wordCount}, estAudio=${Math.round(estimatedAudioMs)}ms, textGen=${Math.round(textGenMs)}ms, remaining=${Math.round(remainingMs)}ms`);
    // Keep aiStreamActive true until estimated audio finishes
    aiStreamTimerRef.current = setTimeout(() => {
      setAiStreamActive(false);
      aiStreamTimerRef.current = null;
    }, remainingMs);
    // Finalize: move streaming text into transcripts
    setTranscripts((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
    setStreamingText("");
    streamingTextRef.current = "";

    // Save AI transcript
    aiTranscriptsRef.current.push(text);
    conversationLogRef.current.push({ role: "teacher", text, ts: Date.now() });

    // ── Phase 3 detection: keyword-based with high turn-count safety net ──
    if (!phase3UpdatedRef.current && verbData) {
      const upper = text.toUpperCase();
      const aiCount = aiTranscriptsRef.current.length;
      // Primary: AI explicitly mentions transition to situations
      const phase3Keywords = upper.includes("SITUATION") || upper.includes("PHASE 3") || upper.includes("상황");
      // Safety net: if AI somehow never says the keyword, force after 12 turns
      const safetyFallback = aiCount >= 12;
      if (phase3Keywords || safetyFallback) {
        console.log("[phase3] Detected Phase 3 transition at AI turn", aiCount, phase3Keywords ? "(keyword)" : "(safety fallback)");
        phase3UpdatedRef.current = true;
        const phase3Instructions = buildPhase3Instructions(
          verbData,
          profile?.difficulty_level || "medium",
          profile?.speech_speed || "medium",
        );
        sendSessionUpdate(phase3Instructions);
        // Force Korean scaffolding start with a hidden nudge
        setTimeout(() => {
          sendUserText("Start Phase 3 now. Begin Step 1 entirely in Korean.", true);
        }, 500);
      }
    }

    // Check for corrections
    const corrMatch = text.match(/CORRECTION:\s*(.+)/i);
    const youSaid = text.match(/You said:\s*(.+)/i);
    if (corrMatch && youSaid) {
      addCorrection({ timestamp: Date.now(), targetSentence: corrMatch[1].trim(), studentTranscript: youSaid[1].trim(), correctedSentence: corrMatch[1].trim(), feedbackLevel: "Try Again" });
    }
    // Primary detection (case-insensitive)
    checkForCompletion(text);
  }, [addCorrection, checkForCompletion, verbData, profile, sendSessionUpdate]);

  const handleUserTranscript = useCallback((text: string) => {
    totalAudioSecondsRef.current += 5;
    if (text.trim()) {
      userTranscriptsRef.current.push(text.trim());
      conversationLogRef.current.push({ role: "student", text: text.trim(), ts: Date.now() });
    }
    if (containsKorean(text) && !phase3UpdatedRef.current) {
      sendUserText('The student said something in Korean: "' + text + '". Infer what they meant. Respond ONLY in English.');
    }
  }, [sendUserText]);

  // ── Save session on stop (for resume later) ──
  const savePartialSession = useCallback(async () => {
    if (!user || !assignmentId) return;
    const totalSessionSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    await updateDailyUsage(totalAudioSecondsRef.current);

    if (currentSessionIdRef.current) {
      // Update existing session
      await supabase.from("speaking_sessions").update({
        duration_seconds: totalSessionSeconds,
        student_transcripts: userTranscriptsRef.current,
        ai_transcripts: aiTranscriptsRef.current,
        conversation_log: conversationLogRef.current,
        session_state: { status: "paused" },
      } as any).eq("id", currentSessionIdRef.current);
    } else {
      // Insert new partial session
      const { data } = await supabase.from("speaking_sessions").insert({
        student_id: user.id,
        assignment_id: assignmentId,
        duration_seconds: totalSessionSeconds,
        student_transcripts: userTranscriptsRef.current,
        ai_transcripts: aiTranscriptsRef.current,
        conversation_log: conversationLogRef.current,
        session_state: { status: "paused" },
      } as any).select("id").single();
      if (data) currentSessionIdRef.current = (data as any).id;
    }
  }, [user, assignmentId]);

  // ── Load previous paused session for resume ──
  const loadPreviousSession = useCallback(async (): Promise<string | null> => {
    if (!user || !assignmentId) return null;
    const { data } = await supabase
      .from("speaking_sessions")
      .select("id, conversation_log, session_state")
      .eq("assignment_id", assignmentId)
      .eq("student_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    const state = (data as any).session_state;
    if (!state || state.status !== "paused") return null;

    const log = (data as any).conversation_log as { role: string; text: string; ts: number }[] | null;
    if (!log || log.length === 0) return null;

    // Save previous log for merging in report
    previousConversationLogRef.current = log;
    currentSessionIdRef.current = data.id;

    // Find last teacher utterance
    const lastTeacher = [...log].reverse().find(e => e.role === "teacher");
    return lastTeacher?.text || null;
  }, [user, assignmentId]);

  // ── Actions ──

  const handleStart = useCallback(async () => {
    if (!verbData) return;
    setUserMuted(false);
    userMutedRef.current = false;
    setTranscripts([]);
    setStreamingText("");
    streamingTextRef.current = "";
    userTranscriptsRef.current = [];
    aiTranscriptsRef.current = [];
    conversationLogRef.current = [];
    completionTriggeredRef.current = false;
    phase3UpdatedRef.current = false;

    // Check for previous paused session
    const lastTeacherText = await loadPreviousSession();

    // ── Audio unlock BEFORE any async work ──
    const unlockAudio = document.createElement("audio");
    unlockAudio.autoplay = true;
    (unlockAudio as any).playsInline = true;
    document.body.appendChild(unlockAudio);
    unlockAudio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    try { await unlockAudio.play(); } catch (err) { console.warn("[handleStart] audio unlock failed:", err); }
    unlockAudio.pause();
    unlockAudio.src = "";

    const instructions = buildSystemInstructions(
      verbData,
      profile?.difficulty_level || "medium",
      profile?.speech_speed || "medium",
    );

    // Build resume context if we have a previous session
    let resumeInstructions = instructions;
    if (lastTeacherText && previousConversationLogRef.current.length > 0) {
      // Get last few exchanges for context
      const recentLog = previousConversationLogRef.current.slice(-6);
      const contextSummary = recentLog.map(e => `${e.role === "teacher" ? "Teacher" : "Student"}: ${e.text}`).join("\n");
      resumeInstructions = instructions + "\n\n═══ RESUME CONTEXT ═══\nThis is a RESUMED session. The student stopped the previous session mid-lesson. Here is what happened in the previous session (last few exchanges):\n" + contextSummary + "\n\nIMPORTANT: Start by briefly welcoming the student back, then repeat what you were last saying. Continue the lesson from exactly where you left off. Do NOT restart from Phase 1.";
    }

    await connect({
      instructions: resumeInstructions,
      voice: ["shimmer", "coral", "sage", "alloy", "ash", "echo", "verse", "ballad"][Math.floor(Math.random() * 8)],
      preUnlockedAudio: unlockAudio,
      turnDetection: { type: "server_vad", threshold: 0.75, prefix_padding_ms: 400, silence_duration_ms: 1000 },
      inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      speed: profile?.speech_speed || "medium",
      onAiTextDelta: handleAiTextDelta,
      onAiTranscriptDone: handleAiTranscriptDone,
      onUserTranscript: handleUserTranscript,
      onStateChange: (state) => {
        if (state === "STUDENT_SPEAKING") {
          // Student interrupted (barge-in) — immediately clear teacher indicator
          if (aiStreamTimerRef.current) { clearTimeout(aiStreamTimerRef.current); aiStreamTimerRef.current = null; }
          setAiStreamActive(false);
          streamingTextRef.current = "";
          setStreamingText("");
        }
        if (state === "IDLE" && !userMutedRef.current) {
          setMicEnabled(true);
        }
      },
      onReady: (_send) => {
        if (lastTeacherText) {
          _send("Resume the lesson. Welcome the student back and continue from where we left off.");
        } else {
          _send("Start the lesson now.");
        }
      },
    });

    sessionStartRef.current = Date.now();
  }, [verbData, profile, connect, handleAiTextDelta, handleAiTranscriptDone, handleUserTranscript, setMicEnabled, loadPreviousSession]);

  const toggleMute = useCallback(() => {
    if (teacherActive) return;
    const next = !userMuted;
    setUserMuted(next);
    userMutedRef.current = next;
    setMicEnabled(!next);
  }, [teacherActive, userMuted, setMicEnabled]);

  const autoExitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCompletion = async (autoDisconnect = true) => {
    setIsComplete(true);
    const totalSessionSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    await updateDailyUsage(totalAudioSecondsRef.current);

    const { data: currentAssignment } = await supabase.from("assignments").select("completed_count").eq("id", assignmentId).single();
    const newCount = ((currentAssignment as any)?.completed_count || 0) + 1;
    await supabase.from("assignments").update({ status: "completed", completed_at: new Date().toISOString(), completed_count: newCount }).eq("id", assignmentId);

    // Merge previous conversation log with current session's log
    const mergedLog: { role: string; text: string; ts: number }[] = [];
    if (previousConversationLogRef.current.length > 0) {
      mergedLog.push(...previousConversationLogRef.current);
      mergedLog.push({ role: "system", text: "--- Session Resumed ---", ts: Date.now() });
    }
    mergedLog.push(...conversationLogRef.current);

    if (user) {
      if (currentSessionIdRef.current) {
        // Update existing paused session → mark as completed with merged log
        await supabase.from("speaking_sessions").update({
          duration_seconds: totalSessionSeconds,
          student_transcripts: userTranscriptsRef.current,
          ai_transcripts: aiTranscriptsRef.current,
          conversation_log: mergedLog,
          session_state: { status: "completed" },
        } as any).eq("id", currentSessionIdRef.current);
      } else {
        await supabase.from("speaking_sessions").insert({
          student_id: user.id,
          assignment_id: assignmentId,
          duration_seconds: totalSessionSeconds,
          student_transcripts: userTranscriptsRef.current,
          ai_transcripts: aiTranscriptsRef.current,
          conversation_log: mergedLog,
          session_state: { status: "completed" },
        } as any);
      }
    }

    // Auto-show report after 20 seconds if user doesn't press Great Job
    autoExitTimerRef.current = setTimeout(() => {
      disconnect();
      setShowReport(true);
    }, 20_000);
  };

  // ── Early returns ──

  if (isBlocked && !verbData) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="rounded-2xl kid-shadow max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="text-5xl">⛔</div>
            <h2 className="text-2xl font-black">Daily Limit Reached</h2>
            <p className="text-muted-foreground font-semibold">Try again tomorrow!</p>
            <Button onClick={() => navigate("/")} className="w-full h-14 text-lg font-bold rounded-xl">Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verbData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl font-bold animate-pulse">Loading... ⏳</div>
      </div>
    );
  }

  // ── Render ──

  return (
    <div className="h-screen bg-background flex flex-col max-w-2xl mx-auto overflow-hidden">
      {/* Header — fixed top */}
      <div className="flex-shrink-0 flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={async () => { if (isConnected) await savePartialSession(); disconnect(); navigate("/"); }} className="rounded-xl">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-black">🗣️ {verbData.verb_key ? formatVerbKey(verbData.verb_key, verbData.meaning_en) : verbData.base_verb}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {correctionHistory.length > 0 && (
            <Button variant="ghost" size="icon" onClick={() => setShowCorrections(!showCorrections)} className="rounded-xl shrink-0">
              <History className="h-4 w-4" />
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={() => setShowSubtitles(!showSubtitles)} className="rounded-xl shrink-0" title={showSubtitles ? "Hide subtitles" : "Show subtitles"}>
            {showSubtitles ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
          </Button>
          <Badge variant="outline" className={"rounded-full text-xs " + (isConnected ? "border-secondary text-secondary" : connectionState === "error" ? "border-destructive text-destructive" : "")}>
            {connectionState}
          </Badge>
          {isComplete && (
            <Badge className="bg-secondary text-secondary-foreground rounded-full px-3">
              <CheckCircle className="h-4 w-4 mr-1" /> Complete!
            </Badge>
          )}
        </div>
      </div>

      {/* Status orb — fixed between header and subtitles */}
      {(isConnected || isConnecting) && (
        <div className="flex-shrink-0 flex flex-col items-center py-4 border-b">
           <div className={"relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-500 " + (
            teacherActive ? "bg-accent/20 shadow-[0_0_40px_hsl(var(--accent)/0.3)]"
              : isConnected ? "bg-secondary/20 shadow-[0_0_40px_hsl(var(--secondary)/0.3)]"
              : "bg-primary/20 animate-pulse"
          )}>
            <span className="text-4xl">{isConnected ? (teacherActive ? "🔊" : "🎤") : "⏳"}</span>
            {isConnected && teacherActive && <div className="absolute inset-0 rounded-full border-2 border-accent/40 animate-ping" />}
          </div>
          {isConnected && (
            <div className="mt-2 text-center">
              <span className={"text-xs font-bold " + (teacherActive ? "text-accent" : "text-secondary")}>
                {teacherActive ? "🔊 Teacher speaking…" : "🎤 Your turn — speak now!"}
              </span>
            </div>
          )}
          {isConnected && userMuted && (
            <div className="text-center text-xs text-destructive font-semibold mt-1">🔇 Microphone muted</div>
          )}
        </div>
      )}

      {/* Main area — scrollable, reverse order (newest at bottom) */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 flex flex-col-reverse gap-4">
        <div ref={messagesEndRef} />

        {/* Streaming subtitle — bottom-most */}
        {showSubtitles && streamingText && (
          <div className="flex justify-start">
            <Card className="max-w-[85%] rounded-2xl kid-shadow border-accent/30">
              <CardContent className="pt-3 pb-3 px-4">
                <p className="text-sm font-semibold mb-1">🤖 Teacher</p>
                <p className="text-base whitespace-pre-wrap"><HighlightedText text={streamingText} /><span className="animate-pulse">▌</span></p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* AI Subtitles — reversed so newest appears at bottom */}
        {showSubtitles && [...transcripts].filter((t) => t.role === "assistant").reverse().map((t, i) => (
          <div key={i} className="flex justify-start">
            <Card className="max-w-[85%] rounded-2xl kid-shadow">
              <CardContent className="pt-3 pb-3 px-4">
                <p className="text-sm font-semibold mb-1">🤖 Teacher</p>
                <p className="text-base whitespace-pre-wrap"><HighlightedText text={t.text} /></p>
              </CardContent>
            </Card>
          </div>
        ))}

        {/* Correction History */}
        {showCorrections && correctionHistory.length > 0 && (
          <Card className="rounded-2xl border-destructive/30">
            <CardContent className="pt-3 pb-3 px-4">
              <p className="text-sm font-bold mb-2">📝 Correction History ({correctionHistory.length})</p>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {correctionHistory.map((c, i) => (
                  <div key={i} className="text-xs border-b border-border pb-2 last:border-0">
                    <p className="text-destructive font-semibold">✗ You said: {c.studentTranscript}</p>
                    <p className="text-secondary font-semibold">✓ Correct: {c.correctedSentence}</p>
                    <Badge variant="outline" className="text-[10px] mt-1">{c.feedbackLevel}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {error && <div className="text-center text-destructive font-semibold">{error}</div>}

        {/* Idle state */}
        {connectionState === "idle" && !isComplete && (
          <div className="text-center py-12 space-y-3">
            <div className="text-5xl">🎙️</div>
            <p className="text-lg font-bold">Ready to practice!</p>
            <p className="text-muted-foreground">Tap "Start Talking" to begin a voice conversation with your AI teacher.</p>
          </div>
        )}
      </div>

      {/* Controls */}
      {/* Controls — fixed bottom */}
      <div className="flex-shrink-0 border-t p-4">
        {isComplete ? (
          <Button onClick={() => { disconnect(); setShowReport(true); }} className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow">🎉 Great Job! View Report</Button>
        ) : connectionState === "idle" ? (
          <Button onClick={handleStart} className="w-full h-16 text-lg font-bold rounded-2xl kid-shadow gap-2">
            <Mic className="h-6 w-6" /> Start Talking 🎤
          </Button>
        ) : (
          <div className="flex gap-3 justify-center">
            <Button onClick={toggleMute} variant={userMuted ? "destructive" : "outline"} className="h-16 w-16 rounded-2xl kid-shadow" disabled={!isConnected || teacherActive}>
              {userMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button onClick={async () => { await savePartialSession(); disconnect(); navigate("/"); }} variant="destructive" className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2">
              <PhoneOff className="h-6 w-6" /> Stop
            </Button>
          </div>
        )}
      </div>

      {/* Auto-show transcript report on completion */}
      {assignmentId && (
        <TranscriptReport
          open={showReport}
          onOpenChange={(open) => {
            setShowReport(open);
            if (!open) {
              if (autoExitTimerRef.current) clearTimeout(autoExitTimerRef.current);
              disconnect();
              navigate("/");
            }
          }}
          assignmentId={assignmentId}
          taskLabel={verbData?.verb_key ? formatVerbKey(verbData.verb_key, verbData.meaning_en) : verbData?.base_verb}
        />
      )}
    </div>
  );
}
