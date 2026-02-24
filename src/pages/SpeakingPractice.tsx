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

// Situation round count
const SITUATION_ROUNDS = 2;

/** Shared preamble for all phases */
function buildPreamble(verb: VerbData, difficultyLevel: string, speechSpeed: string) {
  const ageMap: Record<string, string> = {
    low: "a 4-year-old", medium: "a 7-year-old", high: "a 10-year-old",
  };
  const age = ageMap[difficultyLevel] || ageMap["medium"];
  const maxSent = speechSpeed === "fast" ? "2-3" : "1-2";
  return { age, maxSent };
}

function buildRulesBlock(): string {
  return [
    "── RULES ──",
    "• SILENCE: nothing heard → 'I didn't hear you — try it!' Never pretend they spoke.",
    "• NO-FABRICATION: only quote words student ACTUALLY said.",
    "• Model sentences as standalone (no colons/quotes). BAD: 'Say this: \"I have a plan.\"' GOOD: 'Now say it. I have a plan.'",
    "• Questions must be short standalone sentences for proper TTS.",
    "• Fix only ONE mistake per turn.",
    "• On barge-in, stop and listen, then repeat what you were saying.",
    "• Vary wording every turn.",
  ].join("\n");
}

function buildCorrectionProtocol(): string {
  return [
    "── CORRECTION PROTOCOL (apply in ALL phases) ──",
    "When the student makes a mistake:",
    "1) Acknowledge what they said: 'I heard you say [actual words].' (no fabrication)",
    "2) Model the correct sentence clearly.",
    "3) Ask them to try again: 'Now you try!' → WAIT.",
    "4) If still wrong, model again and ask once more → WAIT.",
    "5) If correct, praise briefly and move on.",
    "This loop is MANDATORY for every student utterance that contains errors.",
  ].join("\n");
}

function buildToneBlock(): string {
  return [
    "── TONE & LANGUAGE ──",
    "Talk like a fun older friend. Never say: sentence, verb, correct, repeat, example, practice, mistake, error, response, translate, grammar, past tense.",
    "Use natural alternatives: 'this one', 'say it again', 'listen to this', 'almost!', 'nice!', 'let's try'.",
    "Praise ONLY as direct reaction to student speech, never as filler. Vary praise words.",
    "When asking student to do something, use 'please', 'go ahead', 'let's try'. For imperative targets, soften with 'Please ~' or 'Can you ~?'.",
    "",
    "── LANGUAGE RULE ──",
    "ALL instructions, praise, corrections, and transition cues MUST be in English.",
    "Use Korean ONLY for explaining sentence meanings ('이건 ... 이라는 뜻이야.').",
    "NEVER say instructions like '잘했어요', '다시 말해볼까요', '과거형으로 해볼게요' in Korean. Say them in English.",
  ].join("\n");
}

/** Phase 1 ONLY — initial instructions. AI sees only Short sentences. */
function buildPhase1Instructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const { age, maxSent } = buildPreamble(verb, difficultyLevel, speechSpeed);
  const shortExamples = [verb.anchor_short_1, verb.anchor_short_2].filter(Boolean);
  const shortList = shortExamples.map((e, i) => `  Short-${i + 1}: "${e}"`).join("\n");

  return [
    `You are a fun, encouraging native-English-speaking friend tutoring a child (imagine ${age}). Keep every turn to ${maxSent} sentences MAX — rapid back-and-forth (tiki-taka).`,
    `Use child-friendly topics (friends, animals, toys, food, family, school, playground, hobbies, sports). Avoid adult topics.`,
    `TARGET VERB: "${verb.base_verb}"`,
    "",
    "── KOREAN RULE ──",
    "After presenting each target sentence, explain its meaning in Korean: '이건 [Korean meaning] 이라는 뜻이야.'",
    "Provide the Korean explanation for EVERY distinct sentence (including tense-varied forms).",
    "However, if the SAME sentence appears again within this phase, do NOT repeat the Korean explanation.",
    "If student seems confused, briefly explain in Korean. Never translate student's English into Korean.",
    "",
    buildToneBlock(),
    "",
    buildCorrectionProtocol(),
    "",
    "── YOUR TASK: SHORT SENTENCES (do Short-1 then Short-2, in order) ──",
    shortList,
    "",
    "NO SITUATION SETUP. Do NOT create imaginary scenarios or situations. Just present the sentence directly and have the student repeat it.",
    "",
    "Each round:",
    "1) Say the target sentence clearly → WAIT for student to repeat.",
    "2) After repeat: praise + Korean meaning → ask to say it ONE MORE TIME → WAIT.",
    "3) Apply CORRECTION PROTOCOL if needed → WAIT.",
    "",
    "TENSE VARIATIONS (both Short-1 and Short-2):",
    "After the student has practiced the base sentence, transform it into these forms:",
    "- Past tense",
    "- Question form",
    `- Progressive (-ing) — ONLY if it makes natural sense for the verb "${verb.base_verb}". If the verb does not naturally take progressive form (e.g. stative verbs like 'know', 'have', 'like'), SKIP progressive.`,
    "For each tense form: say it clearly with Korean meaning → student repeats TWICE.",
    "",
    'After finishing ALL tense variations for Short-2, say a natural transition like "OK, now let\'s try some longer ones!" and then output the marker SHORT DONE on its own.',
    "",
    buildRulesBlock(),
  ].join("\n");
}

/** Phase 2 ONLY — injected via session.update after SHORT DONE */
function buildPhase2Instructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const { age, maxSent } = buildPreamble(verb, difficultyLevel, speechSpeed);
  const longExamples = [verb.anchor_long_1, verb.anchor_long_2].filter(Boolean);
  const longList = longExamples.map((e, i) => `  Long-${i + 1}: "${e}"`).join("\n");

  return [
    `You are a fun, encouraging friend tutoring a child (imagine ${age}). Max ${maxSent} sentences per turn. Child-friendly topics only.`,
    `You just finished teaching short sentences with "${verb.base_verb}". Now: LONG SENTENCES.`,
    `TARGET VERB: "${verb.base_verb}"`,
    "",
    "── KOREAN RULE ──",
    "After presenting each target sentence, explain its meaning in Korean: '이건 [Korean meaning] 이라는 뜻이야.'",
    "Provide the Korean explanation for EVERY distinct sentence.",
    "However, if the SAME sentence appears again within this phase, do NOT repeat the Korean explanation.",
    "If student seems confused, briefly explain in Korean.",
    "",
    buildToneBlock(),
    "",
    buildCorrectionProtocol(),
    "",
    "── YOUR TASK: LONG SENTENCES (do Long-1 then Long-2, in order) ──",
    longList,
    "",
    "NO SITUATION SETUP. Do NOT create imaginary scenarios or situations. Just present the sentence directly.",
    "NO TENSE VARIATIONS. Do NOT transform into past/question/progressive forms. Just practice the sentences as-is.",
    "",
    "Each round:",
    "1) Say the target sentence clearly → WAIT for student to repeat.",
    "2) After repeat: praise + Korean meaning → ask to say it ONE MORE TIME → WAIT.",
    "3) Apply CORRECTION PROTOCOL if needed → WAIT.",
    "",
    'After finishing Long-2, say a natural transition like "Now let\'s try a fun situation!" and then output the marker LONG DONE on its own.',
    "",
    buildRulesBlock(),
  ].join("\n");
}

/** Phase 3 ONLY — injected via session.update after LONG DONE */
function buildPhase3Instructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const { age, maxSent } = buildPreamble(verb, difficultyLevel, speechSpeed);
  const situations = [verb.situation_seed_1, verb.situation_seed_2, verb.situation_seed_3, verb.situation_seed_4].filter(Boolean);
  const sitList = situations.map((s, i) => `  Situation-${i + 1}: ${s}`).join("\n");
  const learned = [verb.anchor_short_1, verb.anchor_short_2, verb.anchor_long_1, verb.anchor_long_2]
    .filter(Boolean).map((e, i) => `  ${i + 1}. "${e}"`).join("\n");

  return [
    `You are a fun, encouraging friend tutoring a child (imagine ${age}). Max ${maxSent} sentences per turn. Child-friendly topics only.`,
    `You just finished teaching "${verb.base_verb}". Now: PHASE 3 — FREE SITUATIONS (2 rounds).`,
    "",
    "Situation seeds:", sitList,
    "Learned sentences:", learned,
    "",
    "── KOREAN RULE ──",
    "When the student successfully forms a sentence, explain its meaning in Korean: '이건 [Korean meaning] 이라는 뜻이야.'",
    "Provide the Korean explanation for EVERY distinct sentence the student produces.",
    "However, if the SAME sentence appears again within this phase, do NOT repeat the Korean explanation.",
    "",
    "NO TENSE VARIATIONS. Do NOT transform sentences into past/question/progressive forms.",
    "",
    buildToneBlock(),
    "",
    `GOAL: Student builds own sentence using "${verb.base_verb}" through Korean-first scaffolding.`,
    "",
    "Each round — follow strictly:",
    "STEP 1 (Korean ONLY): Describe fun scenario in Korean. Ask '너라면 영어로 뭐라고 말할 것 같아?' WAIT.",
    `STEP 2 (English): Acknowledge what they said + give a hint using "${verb.base_verb}" (1-2 words, NOT the full sentence). WAIT for student to try.`,
    "STEP 3: Listen to student's attempt. Correct and polish into a complete sentence. Give Korean meaning. Then say: 'Now say it after me!' and model the complete sentence. WAIT.",
    "STEP 4: Student repeats. Apply CORRECTION PROTOCOL if needed. Then ask them to say it ONE MORE TIME. WAIT.",
    "STEP 5: Student repeats again. Praise and move to next round.",
    'After 2 rounds, say "PRACTICE COMPLETE!"',
    "",
    "── RULES ──",
    "• Step 1 = Korean only. Steps 2-5 = English only (except Korean meaning explanation).",
    "• SILENCE: nothing heard → 'I didn't hear you — try it!' Never pretend they spoke.",
    "• NO-FABRICATION: only quote words student ACTUALLY said.",
    "• Model sentences as standalone (no colons/quotes).",
    "• Fix ONE mistake per turn. Praise only as reaction to speech.",
    "• On barge-in, stop, listen, then repeat.",
    "• Start Round 1 NOW in Korean.",
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

  const phase2UpdatedRef = useRef(false);
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
      upper.includes("LESSON IS COMPLETE")
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

    // ── Phase transition detection: SHORT DONE → Phase 2, LONG DONE → Phase 3 ──
    // IMPORTANT: Once Phase 3 is active, NEVER re-trigger Phase 1 or 2 transitions
    if (verbData && !completionTriggeredRef.current) {
      const upper = text.toUpperCase();

      // SHORT DONE → inject Phase 2 (only if Phase 3 not yet active)
      if (!phase2UpdatedRef.current && !phase3UpdatedRef.current && upper.includes("SHORT DONE")) {
        console.log("[phase2] Detected SHORT DONE at AI turn", aiTranscriptsRef.current.length);
        phase2UpdatedRef.current = true;
        const phase2Instructions = buildPhase2Instructions(
          verbData,
          profile?.difficulty_level || "medium",
          profile?.speech_speed || "medium",
        );
        sendSessionUpdate(phase2Instructions);
        setTimeout(() => {
          sendUserText("Great! Now start Long Sentences. Begin with Long-1.", true);
        }, 500);
      }

      // LONG DONE → inject Phase 3 (only if Phase 2 done and Phase 3 not yet active)
      if (!phase3UpdatedRef.current && phase2UpdatedRef.current && upper.includes("LONG DONE")) {
        console.log("[phase3] Detected LONG DONE at AI turn", aiTranscriptsRef.current.length);
        phase3UpdatedRef.current = true;
        const phase3Instructions = buildPhase3Instructions(
          verbData,
          profile?.difficulty_level || "medium",
          profile?.speech_speed || "medium",
        );
        sendSessionUpdate(phase3Instructions);
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
  }, [addCorrection, checkForCompletion, verbData, profile, sendSessionUpdate, sendUserText]);

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
    phase2UpdatedRef.current = false;
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

    const instructions = buildPhase1Instructions(
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
      voice: ["alloy", "ash", "echo", "shimmer"][Math.floor(Math.random() * 4)],
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
