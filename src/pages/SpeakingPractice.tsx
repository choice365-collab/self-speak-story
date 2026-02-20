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

  const difficultyGuides: Record<string, string> = {
    low: "Speak as if your student is a 5-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 5-year-old would understand.",
    medium: "Speak as if your student is a 7-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 7-year-old would understand.",
    high: "Speak as if your student is a 9-year-old American child. Naturally adjust your vocabulary, sentence length, and grammar to what a 9-year-old would understand.",
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
    "For each round:",
    "1. Pick one short sentence from the list above.",
    '2. Say the sentence naturally. Then IMMEDIATELY say its Korean meaning out loud. Format: "I have a cold — 감기에 걸렸어." This Korean translation is MANDATORY for every new sentence.',
    "3. Explain what it means in a simple, fun way (NO grammar terms).",
    "4. Create a quick, relatable situation where the student would use this sentence.",
    "5. Prompt the student to try saying it (vary your phrasing each time).",
    "6. If correct → react with genuine enthusiasm (vary your reactions) and move on.",
    "7. If wrong → correct naturally within conversation, model the right sentence, and invite them to try again.",
    "After " + SHORT_ROUNDS + " short sentences, move to Phase 2.",
    "",
    "────── PHASE 2: LONG SENTENCES (" + LONG_ROUNDS + " rounds) ──────",
    "Long sentence targets:",
    longList,
    "",
    "For each round:",
    "1. Pick one long sentence from the list above.",
    '2. Say the sentence naturally. Then IMMEDIATELY say its Korean meaning out loud. Format: "I have a bad cold and need to rest — 감기가 심해서 쉬어야 해." This Korean translation is MANDATORY for every new sentence.',
    "3. Explain what it means simply.",
    "4. Create a situation where the student would use this longer sentence.",
    "5. Prompt the student to try saying it (vary your phrasing each time).",
    "6. If correct → react with genuine enthusiasm (vary your reactions) and move on.",
    "7. If wrong → correct naturally within conversation, model the right sentence, and invite them to try again.",
    "After " + LONG_ROUNDS + " long sentences, move to Phase 3.",
    "",
    "────── PHASE 3: FREE SITUATIONS (" + SITUATION_ROUNDS + " rounds) ──────",
    "Situation seeds (expand these into vivid, detailed scenarios):",
    sitList,
    "",
    "For each round:",
    "1. Pick a situation seed and expand it into a fun, detailed 2-3 sentence scenario.",
    "2. Prompt the student to respond in English (vary your phrasing). Do NOT give the answer.",
    "3. Listen to their response.",
    "4. If correct → celebrate naturally (vary your reactions). Move to next situation.",
    "5. If wrong or incomplete:",
    "   - Acknowledge their effort with a natural, varied reaction.",
    "   - Quote what they said, then show the corrected version naturally.",
    "   - Ask them to say the corrected sentence 2 times.",
    "After " + SITUATION_ROUNDS + ' situations, say "PRACTICE COMPLETE!" to end the lesson.',
    "",
    "═══ RULES ═══",
    koreanHintRule,
    "• Always create a situation FIRST, then let them try. Never just say 'Repeat after me.'",
    "• When creating a situation, match WHO the student would say the sentence to. If the target sentence is advice to someone else, put a friend/family member in the scene. If it's something you'd say to yourself, set a solo scenario. The listener must fit the sentence.",
    "• Fix only ONE mistake per turn. Keep corrections brief and natural.",
    "• Don't repeat yourself. If you already explained something, move forward.",
    "• When the student interrupts, stop and listen. Respond to what they said.",
    "• Track your progress: announce when moving between phases (e.g., 'Great! Now let\\'s try some longer sentences!').",
    "• Vary your wording every turn. Never start two consecutive turns the same way.",
    "• Use diverse praise — never repeat the same one back-to-back.",
    "• Rephrase your prompts creatively each time.",
    "• Sound like a real person, not a script. Surprise the student with your energy and creativity.",
  ].filter(Boolean).join("\n");
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
  const [showSubtitles, setShowSubtitles] = useState(true);
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

  // Hook
  const {
    status: connectionState,
    error,
    isAiSpeaking,
    connect,
    disconnect,
    setMicEnabled,
    sendUserText,
  } = useRealtimeWebRTC();

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  // ── Side effects ──

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, streamingText]);

  useEffect(() => {
    loadAssignment();
    return () => disconnect();
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

  const handleAiTextDelta = useCallback((delta: string) => {
    streamingTextRef.current += delta;
    setStreamingText(streamingTextRef.current);
  }, []);

  const handleAiTranscriptDone = useCallback((text: string) => {
    // Finalize: move streaming text into transcripts
    setTranscripts((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
    setStreamingText("");
    streamingTextRef.current = "";

    // Check for corrections
    const corrMatch = text.match(/CORRECTION:\s*(.+)/i);
    const youSaid = text.match(/You said:\s*(.+)/i);
    if (corrMatch && youSaid) {
      addCorrection({ timestamp: Date.now(), targetSentence: corrMatch[1].trim(), studentTranscript: youSaid[1].trim(), correctedSentence: corrMatch[1].trim(), feedbackLevel: "Try Again" });
    }
    if (text.includes("PRACTICE COMPLETE")) handleCompletion(false);
  }, [addCorrection]);

  const handleUserTranscript = useCallback((text: string) => {
    totalAudioSecondsRef.current += 5;
    if (containsKorean(text)) {
      sendUserText('The student said something in Korean: "' + text + '". Infer what they meant. Respond ONLY in English.');
    }
  }, [sendUserText]);

  // ── Actions ──

  const handleStart = useCallback(async () => {
    if (!verbData) return;
    setUserMuted(false);
    userMutedRef.current = false;
    setTranscripts([]);
    setStreamingText("");
    streamingTextRef.current = "";

    const instructions = buildSystemInstructions(
      verbData,
      profile?.difficulty_level || "medium",
      profile?.speech_speed || "medium",
    );

    await connect({
      instructions,
      voice: "shimmer",
      turnDetection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 3000 },
      inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      speed: profile?.speech_speed || "medium",
      onAiTextDelta: handleAiTextDelta,
      onAiTranscriptDone: handleAiTranscriptDone,
      onUserTranscript: handleUserTranscript,
      onStateChange: (state) => {
        // Clear streaming buffer on barge-in
        if (state === "STUDENT_SPEAKING") {
          streamingTextRef.current = "";
          setStreamingText("");
        }
        if (state === "IDLE" && !userMutedRef.current) {
          setMicEnabled(true);
        }
      },
      onReady: (_send) => {
        // Trigger AI's first response without sending user text.
        // The system instructions guide what the AI says.
        _send("Start the lesson now.");
      },
    });

    sessionStartRef.current = Date.now();
  }, [verbData, profile, connect, handleAiTextDelta, handleAiTranscriptDone, handleUserTranscript, setMicEnabled]);

  const toggleMute = useCallback(() => {
    if (isAiSpeaking) return;
    const next = !userMuted;
    setUserMuted(next);
    userMutedRef.current = next;
    setMicEnabled(!next);
  }, [isAiSpeaking, userMuted, setMicEnabled]);

  const handleCompletion = async (autoDisconnect = true) => {
    setIsComplete(true);
    const totalSessionSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    await updateDailyUsage(totalAudioSecondsRef.current);

    const { data: currentAssignment } = await supabase.from("assignments").select("completed_count").eq("id", assignmentId).single();
    const newCount = ((currentAssignment as any)?.completed_count || 0) + 1;
    await supabase.from("assignments").update({ status: "completed", completed_at: new Date().toISOString(), completed_count: newCount }).eq("id", assignmentId);

    if (user) {
      await supabase.from("speaking_sessions").insert({ student_id: user.id, assignment_id: assignmentId, duration_seconds: totalSessionSeconds });
    }
    if (autoDisconnect) {
      setTimeout(() => disconnect(), 2000);
    }
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
        <Button variant="ghost" size="icon" onClick={() => { disconnect(); navigate("/"); }} className="rounded-xl">
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
            isAiSpeaking ? "bg-accent/20 shadow-[0_0_40px_hsl(var(--accent)/0.3)]"
              : isConnected ? "bg-secondary/20 shadow-[0_0_40px_hsl(var(--secondary)/0.3)]"
              : "bg-primary/20 animate-pulse"
          )}>
            <span className="text-4xl">{isConnected ? (isAiSpeaking ? "🔊" : "🎤") : "⏳"}</span>
            {isConnected && isAiSpeaking && <div className="absolute inset-0 rounded-full border-2 border-accent/40 animate-ping" />}
          </div>
          {isConnected && (
            <div className="mt-2 text-center">
              <span className={"text-xs font-bold " + (isAiSpeaking ? "text-accent" : "text-secondary")}>
                {isAiSpeaking ? "🔊 Teacher speaking…" : "🎤 Your turn — speak now!"}
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
          <Button onClick={() => { disconnect(); navigate("/"); }} className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow">🎉 Great Job! Go Back</Button>
        ) : connectionState === "idle" ? (
          <Button onClick={handleStart} className="w-full h-16 text-lg font-bold rounded-2xl kid-shadow gap-2">
            <Mic className="h-6 w-6" /> Start Talking 🎤
          </Button>
        ) : (
          <div className="flex gap-3 justify-center">
            <Button onClick={toggleMute} variant={userMuted ? "destructive" : "outline"} className="h-16 w-16 rounded-2xl kid-shadow" disabled={!isConnected || isAiSpeaking}>
              {userMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button onClick={() => { disconnect(); navigate("/"); }} variant="destructive" className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2">
              <PhoneOff className="h-6 w-6" /> Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
