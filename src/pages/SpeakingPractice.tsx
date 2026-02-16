import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mic, MicOff, PhoneOff, CheckCircle, History } from "lucide-react";
import { formatVerbKey } from "@/lib/formatVerbKey";
import { type CorrectionEntry } from "@/lib/evaluateAttempt";
import SilenceTimer from "@/components/SilenceTimer";
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

// ── System instructions builder ──

function buildSystemInstructions(verb: VerbData, difficultyLevel: string, speechSpeed: string): string {
  const situations = [verb.situation_seed_1, verb.situation_seed_2, verb.situation_seed_3, verb.situation_seed_4].filter(Boolean);
  const shortExamples = [verb.anchor_short_1, verb.anchor_short_2, verb.anchor_short_3].filter(Boolean);
  const longExamples = [verb.anchor_long_1, verb.anchor_long_2, verb.anchor_long_3].filter(Boolean);
  const allExamples = [...shortExamples, ...longExamples];

  const exList = allExamples.map((e, i) => "  " + (i + 1) + '. "' + e + '"').join("\n");
  const sitList = situations.map((s, i) => "  " + (i + 1) + ". " + s).join("\n");

  const difficultyGuides: Record<string, string> = {
    low: "Use only simple sentences. Basic vocabulary only.",
    medium: "Use moderate grammar with common expressions.",
    high: "Use natural, varied grammar including idioms.",
  };
  const speedGuides: Record<string, string> = {
    slow: "Speak VERY slowly. SHORT sentences (3-6 words). Repeat key phrases.",
    medium: "Speak slowly and clearly. Short sentences (5-8 words).",
    fast: "Speak at a moderate pace. Normal length sentences.",
  };

  return [
    "You are an energetic, supportive English teacher.",
    "",
    "LANGUAGE RULE (STRICT):",
    "- Speak only in English.",
    "- Never use Korean.",
    "- Never translate into Korean.",
    "- You may understand Korean input internally, but always reply in English.",
    "",
    "TEACHING STYLE:",
    "- Be energetic, positive, and encouraging.",
    "- Keep sentences clear and lively.",
    "- Avoid long pauses.",
    "- Keep explanations short and focused.",
    "",
    "DIFFICULTY: " + difficultyLevel.toUpperCase() + " - " + (difficultyGuides[difficultyLevel] || difficultyGuides["medium"]),
    "PACE: " + speechSpeed.toUpperCase() + " - " + (speedGuides[speechSpeed] || speedGuides["medium"]),
    "",
    'The student is learning the verb: "' + verb.base_verb + '"',
    "",
    "LESSON FLOW:",
    "1) You MUST speak first.",
    "2) Introduce the target sentence using a vivid situation in simple English (2-4 sentences).",
    "   Do NOT define or translate.",
    "   Help the student guess meaning from context.",
    "   Example style:",
    '   "Imagine you just finished cooking dinner for your family.',
    "    Everyone is sitting at the table waiting.",
    "    Your mom asks what you did.",
    "    In that situation, you can say: 'I made dinner.'\"",
    "3) Clearly model the sentence once.",
    '   Then say: "Your turn. Go ahead."',
    "",
    "Example sentences to practice:",
    exList,
    "",
    "Situation seeds:",
    sitList,
    "",
    "SILENCE HANDLING:",
    "- If the student is silent for about 1 second:",
    '  Give a short soft prompt: "Go ahead!" / "You can do it!"',
    "- If silence continues:",
    '  Repeat the model sentence once and say: "Let\'s say it together."',
    "",
    "CORRECTION RULE (VERY IMPORTANT):",
    "If the student makes a mistake, you MUST follow this 4-part structure:",
    '(A) Short encouragement: "Nice try!" / "Good attempt!"',
    "(B) Explain the main mistake briefly (1-2 short sentences only).",
    "    Focus on ONE main issue: tense, word order, missing word, wrong verb form, or off-topic.",
    '(C) Give the corrected sentence clearly: "Correct: [sentence]"',
    '(D) Ask for repetition: "Now repeat: [sentence]"',
    'Do NOT say only "Try again." Do NOT give long grammar lectures. Keep it short and clear.',
    "",
    "TENSE COACHING:",
    "If tense is wrong, briefly contrast:",
    '- Present (habit): "I make dinner every day."',
    '- Past (finished): "I made dinner yesterday."',
    '- Continuous (happening now): "I am making dinner now."',
    "Then clearly state which one fits the situation and ask the student to repeat.",
    "",
    "MIXED KOREAN HANDLING:",
    "If the student mixes Korean:",
    "- Infer intended meaning.",
    "- Reformulate into natural English.",
    "- Apply the same 4-part correction structure.",
    "- Never mention Korean explicitly.",
    "",
    "PRAISE WHEN CORRECT:",
    '- Use short energetic praise: "Great!" / "Perfect!" / "Nice job!"',
    '- Optionally: "Say it again with confidence!"',
    "- Stay energetic and keep the conversation flowing naturally.",
    "",
    "Require 2-3 correct repetitions per sentence before moving on.",
    'After completing ALL situations, say "PRACTICE COMPLETE!" at the end.',
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
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [userMuted, setUserMuted] = useState(false);
  const [showCorrections, setShowCorrections] = useState(false);
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
  const silenceCountRef = useRef(0);

  // Hook — single source of truth for WebRTC
  const {
    status: connectionState,
    error,
    isAiSpeaking,
    speechDetected,
    connect,
    disconnect,
    setMicEnabled,
    setSpeakerMuted,
    sendUserText,
  } = useRealtimeWebRTC();

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

  // Reset silence counter when speech is detected or AI starts speaking
  useEffect(() => {
    if (speechDetected || isAiSpeaking) {
      silenceCountRef.current = 0;
    }
  }, [speechDetected, isAiSpeaking]);

  // ── Side effects ──

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

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

  // ── Callbacks for the hook ──

  const handleAiTranscript = useCallback((text: string) => {
    setTranscripts((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
    const corrMatch = text.match(/CORRECTION:\s*(.+)/i);
    const youSaid = text.match(/You said:\s*(.+)/i);
    if (corrMatch && youSaid) {
      addCorrection({ timestamp: Date.now(), targetSentence: corrMatch[1].trim(), studentTranscript: youSaid[1].trim(), correctedSentence: corrMatch[1].trim(), feedbackLevel: "Try Again" });
    }
    if (text.includes("PRACTICE COMPLETE")) handleCompletion();
  }, [addCorrection]);

  const handleUserTranscript = useCallback((text: string) => {
    totalAudioSecondsRef.current += 5;
    if (containsKorean(text)) {
      console.log("[filter] Korean detected, inferring intent and prompting English");
      sendUserText('The student said something in Korean: "' + text + '". Infer what they meant. Respond ONLY in English: "I think you mean: \'<correct English>\'. Let\'s say it in English. Repeat: \'<correct English>\'." Never use Korean.');
    }
    // User transcripts: internal only, not displayed
  }, [sendUserText]);

  const handleAiSpeakingEnd = useCallback(() => {
    if (!userMutedRef.current) {
      setMicEnabled(true);
    }
  }, [setMicEnabled]);

  // ── Actions ──

  const handleStart = useCallback(async () => {
    if (!verbData) return;
    setUserMuted(false);
    userMutedRef.current = false;
    setTranscripts([]);
    silenceCountRef.current = 0;

    const instructions = buildSystemInstructions(
      verbData,
      profile?.difficulty_level || "medium",
      profile?.speech_speed || "medium",
    );

    await connect({
      instructions,
      voice: "alloy",
      turnDetection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 3000 },
      inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      speed: profile?.speech_speed || "medium",
      onAiTranscript: handleAiTranscript,
      onUserTranscript: handleUserTranscript,
      onAiSpeakingEnd: handleAiSpeakingEnd,
      onReady: (send) => {
        send("Start the lesson now. Introduce the verb and the first example sentence with a vivid situation context. Follow the lesson rules.");
      },
    });

    sessionStartRef.current = Date.now();
  }, [verbData, profile, connect, handleAiTranscript, handleUserTranscript, handleAiSpeakingEnd]);

  const toggleMute = useCallback(() => {
    if (isAiSpeaking) return;
    const next = !userMuted;
    setUserMuted(next);
    userMutedRef.current = next;
    setMicEnabled(!next);
  }, [isAiSpeaking, userMuted, setMicEnabled]);

  const handleSilenceTimeout = useCallback(() => {
    silenceCountRef.current += 1;
    const count = silenceCountRef.current;
    if (count === 1) {
      console.log("[silence] 1s soft prompt");
      sendUserText("The student is quiet. Give a SHORT soft encouragement (2-5 words only). Examples: 'Go ahead.' / 'You can do it.' / 'Keep going.' Do NOT repeat the sentence yet.");
    } else {
      console.log("[silence] 2s full re-guide");
      silenceCountRef.current = 0;
      sendUserText("The student is still silent. Say: \"Let's say it together.\" Then repeat the current target sentence clearly. Keep it encouraging.");
    }
  }, [sendUserText]);

  const handleCompletion = async () => {
    setIsComplete(true);
    const totalSessionSeconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
    await updateDailyUsage(totalAudioSecondsRef.current);

    const { data: currentAssignment } = await supabase.from("assignments").select("completed_count").eq("id", assignmentId).single();
    const newCount = ((currentAssignment as any)?.completed_count || 0) + 1;
    await supabase.from("assignments").update({ status: "completed", completed_at: new Date().toISOString(), completed_count: newCount }).eq("id", assignmentId);

    if (user) {
      await supabase.from("speaking_sessions").insert({ student_id: user.id, assignment_id: assignmentId, duration_seconds: totalSessionSeconds });
    }
    setTimeout(() => disconnect(), 2000);
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
    <div className="min-h-screen bg-background flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
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

      {/* Main area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status orb */}
        {(isConnected || isConnecting) && (
          <div className="flex justify-center py-6">
            <div className={"relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 " + (
              isAiSpeaking ? "bg-accent/20 shadow-[0_0_40px_hsl(var(--accent)/0.3)]"
                : isConnected ? "bg-secondary/20 shadow-[0_0_40px_hsl(var(--secondary)/0.3)]"
                : "bg-primary/20 animate-pulse"
            )}>
              <span className="text-4xl">{isConnected ? (isAiSpeaking ? "🔊" : "🎤") : "⏳"}</span>
              {isConnected && isAiSpeaking && <div className="absolute inset-0 rounded-full border-2 border-accent/40 animate-ping" />}
            </div>
            {isConnected && (
              <div className="absolute mt-36 text-center">
                <span className={"text-xs font-bold " + (isAiSpeaking ? "text-accent" : "text-secondary")}>
                  {isAiSpeaking ? "🔊 Teacher speaking…" : "🎤 Your turn — speak now!"}
                </span>
              </div>
            )}
          </div>
        )}

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

        {/* Idle state */}
        {connectionState === "idle" && !isComplete && (
          <div className="text-center py-12 space-y-3">
            <div className="text-5xl">🎙️</div>
            <p className="text-lg font-bold">Ready to practice!</p>
            <p className="text-muted-foreground">Tap "Start Talking" to begin a voice conversation with your AI teacher.</p>
          </div>
        )}

        {error && <div className="text-center text-destructive font-semibold">{error}</div>}

        {isConnected && userMuted && (
          <div className="text-center text-sm text-destructive font-semibold">🔇 Microphone muted — tap mic button to unmute</div>
        )}

        {/* AI Subtitles only */}
        {transcripts.filter((t) => t.role === "assistant").map((t, i) => {
          const mainText = t.text;
          return (
            <div key={i} className="flex justify-start">
              <Card className="max-w-[85%] rounded-2xl kid-shadow">
                <CardContent className="pt-3 pb-3 px-4">
                  <p className="text-sm font-semibold mb-1">🤖 Teacher</p>
                  <p className="text-base whitespace-pre-wrap">{mainText}</p>
                </CardContent>
              </Card>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Silence Timer — 1s tiered behavior */}
      {isConnected && !userMuted && !isAiSpeaking && !speechDetected && (
        <div className="flex justify-center pb-2">
          <SilenceTimer active durationMs={1000} onTimeout={handleSilenceTimeout} />
        </div>
      )}

      {/* Controls */}
      <div className="border-t p-4">
        {isComplete ? (
          <Button onClick={() => navigate("/")} className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow">🎉 Great Job! Go Back</Button>
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
