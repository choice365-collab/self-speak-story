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
import { type CorrectionEntry, type FeedbackLevel } from "@/lib/evaluateAttempt";
import SilenceTimer from "@/components/SilenceTimer";

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

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

function containsKorean(text: string): boolean {
  return /[가-힣]/.test(text);
}

function buildSystemInstructions(verb: VerbData, difficultyLevel: string, speechSpeed: string, _koreanHintMode: boolean): string {
  const situations = [verb.situation_seed_1, verb.situation_seed_2, verb.situation_seed_3, verb.situation_seed_4].filter(Boolean);
  const shortExamples = [verb.anchor_short_1, verb.anchor_short_2, verb.anchor_short_3].filter(Boolean);
  const longExamples = [verb.anchor_long_1, verb.anchor_long_2, verb.anchor_long_3].filter(Boolean);
  const allExamples = [...shortExamples, ...longExamples];

  const difficultyGuides: Record<string, string> = {
    low: "Use only simple sentences (subject + verb + object). Avoid complex grammar, conditionals, or passive voice. Use basic vocabulary only.",
    medium: "Use moderate grammar complexity. You may use simple compound sentences and common expressions. Keep vocabulary accessible.",
    high: "Use natural, varied grammar including compound/complex sentences, conditionals, and idiomatic expressions. Challenge the student.",
  };
  const difficultyGuide = difficultyGuides[difficultyLevel] || difficultyGuides["medium"];

  const speedGuides: Record<string, string> = {
    slow: "Speak EXTREMELY slowly and clearly with long pauses between words. Use VERY SHORT sentences (3-6 words max). Pause 2-3 seconds between sentences. Repeat every key phrase twice.",
    medium: "Speak slowly and clearly. Use short sentences (5-8 words). Pause between sentences. Enunciate each word distinctly.",
    fast: "Speak at a moderate, unhurried pace. Use sentences of normal length. Be clear and deliberate, not rushed.",
  };
  const speedGuide = speedGuides[speechSpeed] || speedGuides["medium"];

  const exampleList = allExamples.map((e, i) => `  ${i + 1}. "${e}"`).join("\n");
  const situationList = situations.map((s, i) => `  ${i + 1}. ${s}`).join("\n");

  return `You are an English-speaking AI tutor for elementary students.

===== CRITICAL LANGUAGE RULE =====
- Korean is allowed ONLY ONCE: when you first introduce a new example sentence, explain the FULL sentence meaning in Korean.
- After that single Korean explanation, ALL interaction must be 100% in English.
- Korean must NEVER be used in feedback, correction, retry prompts, praise, or any other interaction.
- The Korean explanation must cover the ENTIRE sentence meaning, not just the verb.

===== GENERAL RULES =====
- Be patient, encouraging, and clear.
- Keep each response SHORT (2-3 sentences max).
- Do NOT praise silence or irrelevant answers.
- Only say "GREAT!" or "GOOD!" when the student actually spoke in English AND the attempt is acceptable.

DIFFICULTY LEVEL: ${difficultyLevel.toUpperCase()}
${difficultyGuide}

SPEAKING PACE: ${speechSpeed.toUpperCase()}
${speedGuide}

The student is learning the verb: "${verb.base_verb}"
Meaning: ${verb.meaning_en || ""}

===== AI MUST SPEAK FIRST =====
When the lesson starts, speak IMMEDIATELY with this structure:
1. "Today we will practice the verb '${verb.base_verb}'."
2. Say the first example sentence in English.
3. Then explain the FULL sentence meaning in Korean (e.g. "이 문장은 '...' 라는 뜻이야.")
4. After this, switch to English-only mode permanently for this sentence.
5. Ask the student to repeat the sentence.

===== LESSON STRUCTURE (STRICT ORDER) =====

--- Step A: Explanation & Repeat Practice ---
Use exactly these example sentences:
${exampleList}

For EACH example sentence:
  a) Say the sentence clearly in English.
  b) Explain the full sentence meaning in Korean ONCE (this is the ONLY time Korean is allowed).
  c) Ask the student to repeat in English: "Now repeat after me: [sentence]"
  d) If incorrect, say "TRY AGAIN." and repeat the correct sentence once.
  e) Require 2–3 correct repetitions before moving on.

--- Step B: Situation Practice ---
Use these situation seeds:
${situationList}

For EACH situation:
  a) Describe the situation in English and ask the student to create a sentence using "${verb.base_verb}".
  b) If the student is silent: wait 3 seconds, then say "I didn't hear anything. Please try again." and repeat the target sentence.
  c) If incorrect: say "TRY AGAIN." and repeat the correct sentence once.
  d) Ask for 2–3 correct repetitions.
  e) NO Korean allowed in situation practice.

===== SILENCE HANDLING (3 SECONDS) =====
If the student is silent for about 3 seconds:
  - Say: "I didn't hear anything. Please try again."
  - Repeat the example sentence once.
  - Wait for the student to respond.
  - Maximum 2 re-prompts per turn before simplifying and moving on.

===== KOREAN INPUT HANDLING =====
If the student speaks Korean:
  - Say: "Please speak in English. Let's try again."
  - Repeat the target sentence once.
  - Do NOT respond to the Korean content. Do NOT translate it. Do NOT praise it.

===== CORRECTION FLOW (ENGLISH ONLY) =====
If the student's sentence is incorrect, respond with:
  "TRY AGAIN."
  Then repeat the correct target sentence once.
- NEVER use Korean in corrections.

===== FEEDBACK RULES =====
Use ONLY these feedback words:
  - "GREAT!" or "GOOD!" → student spoke in English AND the attempt is correct/acceptable
  - "TRY AGAIN." → incorrect, silent, off-topic, or Korean input
Do NOT use any numeric score, star rating, percentage, or rubric.
Do NOT praise silence, off-topic, or Korean input.

===== BEHAVIOR =====
- Do NOT overpraise. Only praise genuine correct English attempts.
- If student struggles repeatedly, simplify the sentence.
- Keep lesson dynamic and interactive.
- Do not skip repetition.
- Always bring the conversation back to practicing "${verb.base_verb}".

===== COMPLETION =====
After completing ALL 4 situations successfully, congratulate the student and say exactly "PRACTICE COMPLETE!" at the end.`;
}

export default function SpeakingPractice() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [verbData, setVerbData] = useState<VerbData | null>(null);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [aiSpeaking, setAiSpeaking] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionStart] = useState(Date.now());
  const [correctionHistory, setCorrectionHistory] = useState<CorrectionEntry[]>(() => {
    try {
      const stored = localStorage.getItem(`corrections_${assignmentId}`);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showCorrections, setShowCorrections] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const totalAudioSecondsRef = useRef(0);
  const sessionStartTimeRef = useRef(Date.now());
  const perfRef = useRef<Record<string, number>>({});

  // Perf logging helper
  const perf = useCallback((label: string) => {
    const now = performance.now();
    perfRef.current[label] = now;
    console.log(`[perf] ${label}: ${now.toFixed(1)}ms`);
  }, []);

  // Mic control: mute while AI speaking, unmute when done
  const setMicEnabled = useCallback((enabled: boolean) => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = enabled;
      // Only show red mute button if user manually muted, NOT during AI speech
      // isMuted reflects manual user mute state, not AI-controlled mute
      if (enabled) {
        setIsMuted(false);
        setSpeechDetected(false);
        perf("t_start_listening");
      }
    }
  }, [perf]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  useEffect(() => {
    loadAssignment();
    return () => disconnect();
  }, [assignmentId]);

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
    if (blocked) {
      toast.error("Daily limit reached. Try again tomorrow!");
      return;
    }
    const { data } = await supabase
      .from("assignments")
      .select("*, verbs(*)")
      .eq("id", assignmentId)
      .single();
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
      .from("daily_usage")
      .select("id, used_seconds")
      .eq("student_id", user.id)
      .eq("date", today)
      .maybeSingle();
    if (existing) {
      const newUsed = existing.used_seconds + addSeconds;
      await supabase.from("daily_usage").update({ used_seconds: newUsed }).eq("id", existing.id);
      if (newUsed >= limitSeconds) setIsBlocked(true);
    } else {
      await supabase.from("daily_usage").insert({
        student_id: user.id,
        date: today,
        used_seconds: addSeconds,
        limit_seconds: limitSeconds,
      });
    }
  };

  const addCorrection = useCallback((entry: CorrectionEntry) => {
    setCorrectionHistory((prev) => {
      const updated = [...prev, entry];
      try { localStorage.setItem(`corrections_${assignmentId}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, [assignmentId]);

  const addTranscript = useCallback((role: "user" | "assistant", text: string) => {
    // Only store assistant transcripts for display (subtitles)
    // User transcripts stored internally but not displayed
    setTranscripts((prev) => [...prev, { role, text, timestamp: Date.now() }]);

    if (role === "assistant") {
      // Parse corrections from AI and store
      const correctionMatch = text.match(/CORRECTION:\s*(.+)/i);
      const youSaidMatch = text.match(/You said:\s*(.+)/i);
      if (correctionMatch && youSaidMatch) {
        addCorrection({
          timestamp: Date.now(),
          targetSentence: correctionMatch[1].trim(),
          studentTranscript: youSaidMatch[1].trim(),
          correctedSentence: correctionMatch[1].trim(),
          feedbackLevel: "Try Again",
        });
      }
    }
  }, [addCorrection]);

  const connect = useCallback(async () => {
    if (!verbData) return;
    setConnectionState("connecting");
    setError(null);

    try {
      const instructions = buildSystemInstructions(verbData, profile?.difficulty_level || "medium", profile?.speech_speed || "medium", profile?.korean_hint_mode ?? false);

      // Unlock AudioContext on user gesture
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current.state === "suspended") {
        await audioCtxRef.current.resume();
      }

      // Reuse existing stream if available, otherwise acquire new one
      let stream = streamRef.current;
      if (!stream || stream.getAudioTracks().length === 0 || stream.getAudioTracks()[0].readyState === "ended") {
        try {
          const permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (permStatus.state === "denied") {
            throw new Error("Microphone permission denied. Please enable it in browser settings.");
          }
        } catch (permErr: any) {
          if (permErr.message?.includes("denied")) throw permErr;
        }
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStorage.setItem("micPermissionGranted", "true");
        streamRef.current = stream;
      }

      // Start with mic OFF — AI speaks first (but DON'T set isMuted=true, that's for user toggle)
      stream.getAudioTracks().forEach((track) => { track.enabled = false; });

      const tokenRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            voice: "alloy",
            instructions,
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 3000 },
            input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
            speed: profile?.speech_speed || "medium",
          }),
        }
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || `Token request failed: ${tokenRes.status}`);
      }

      const session = await tokenRes.json();
      const ephemeralKey = session.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key returned");

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        perf("t_audio_track_received");
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);

          if (event.type === "input_audio_buffer.speech_started") {
            setSpeechDetected(true);
            perf("t_speech_detected");
          }

          if (event.type === "input_audio_buffer.speech_stopped") {
            perf("t_end_of_speech");
          }

          // AI starts speaking → mic OFF
          if (event.type === "response.audio.delta") {
            if (!perfRef.current["t_first_ai_audio"]) {
              perf("t_first_ai_audio");
            }
            setAiSpeaking(true);
            setSpeechDetected(false);
            // Mute mic track but don't set isMuted (red button)
            const trk = streamRef.current?.getAudioTracks()[0];
            if (trk) trk.enabled = false;
          }

          if (event.type === "response.audio_transcript.done" && event.transcript) {
            addTranscript("assistant", event.transcript);

            if (event.transcript.includes("PRACTICE COMPLETE")) {
              handleCompletion();
            }
          }

          if (event.type === "response.done") {
            setAiSpeaking(false);
            setMicEnabled(true);
            perf("t_tts_done");
            // Reset per-turn perf markers
            delete perfRef.current["t_first_ai_audio"];
          }

          if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
            const transcript = event.transcript.trim();
            addTranscript("user", transcript);
            totalAudioSecondsRef.current += 5;
          }
        } catch {}
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const model = session.model || "gpt-4o-mini-realtime-preview";
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${model}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ephemeralKey}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );

      if (!sdpRes.ok) {
        throw new Error(`SDP exchange failed: ${sdpRes.status}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setConnectionState("connected");
      sessionStartTimeRef.current = Date.now();
      perf("t_session_connected");

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setConnectionState("error");
          setError("Connection lost");
        }
      };
    } catch (e: any) {
      console.error("WebRTC connect error:", e);
      setConnectionState("error");
      setError(e.message || "Failed to connect");
      toast.error(e.message || "Failed to connect");
    }
  }, [verbData, addTranscript, profile, perf, setMicEnabled]);

  const disconnect = useCallback((stopStream = true) => {
    dcRef.current?.close();
    pcRef.current?.close();
    if (stopStream) {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    setConnectionState("idle");
    setIsMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || aiSpeaking) return; // Don't allow unmute while AI speaking
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  }, [aiSpeaking]);

  const handleCompletion = async () => {
    setIsComplete(true);
    const totalSessionSeconds = Math.floor((Date.now() - sessionStart) / 1000);

    // Update daily usage
    await updateDailyUsage(totalAudioSecondsRef.current);

    // Get current assignment to increment completed_count
    const { data: currentAssignment } = await supabase
      .from("assignments")
      .select("completed_count")
      .eq("id", assignmentId)
      .single();

    const newCount = ((currentAssignment as any)?.completed_count || 0) + 1;

    // Mark assignment complete
    await supabase.from("assignments")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_count: newCount,
      })
      .eq("id", assignmentId);

    // Record speaking session
    if (user) {
      await supabase.from("speaking_sessions").insert({
        student_id: user.id,
        assignment_id: assignmentId,
        duration_seconds: totalSessionSeconds,
      });
    }

    setTimeout(() => disconnect(), 2000);
  };

  if (isBlocked && !verbData) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="rounded-2xl kid-shadow max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="text-5xl">⛔</div>
            <h2 className="text-2xl font-black">Daily Limit Reached</h2>
            <p className="text-muted-foreground font-semibold">Try again tomorrow!</p>
            <Button onClick={() => navigate("/")} className="w-full h-14 text-lg font-bold rounded-xl">
              Go Back
            </Button>
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

  const isConnected = connectionState === "connected";
  const isConnecting = connectionState === "connecting";

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
          <Badge
            variant="outline"
            className={`rounded-full text-xs ${
              isConnected ? "border-secondary text-secondary" : connectionState === "error" ? "border-destructive text-destructive" : ""
            }`}
          >
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
        {(isConnected || isConnecting) && (
          <div className="flex justify-center py-6">
            <div
              className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                aiSpeaking
                  ? "bg-accent/20 shadow-[0_0_40px_hsl(var(--accent)/0.3)]"
                  : isConnected
                    ? "bg-secondary/20 shadow-[0_0_40px_hsl(var(--secondary)/0.3)]"
                    : "bg-primary/20 animate-pulse"
              }`}
            >
              <span className="text-4xl">{isConnected ? (aiSpeaking ? "🔊" : "🎤") : "⏳"}</span>
              {isConnected && aiSpeaking && (
                <div className="absolute inset-0 rounded-full border-2 border-accent/40 animate-ping" />
              )}
            </div>
            {isConnected && (
              <div className="absolute mt-36 text-center">
                <span className={`text-xs font-bold ${aiSpeaking ? "text-accent" : "text-secondary"}`}>
                  {aiSpeaking ? "🔊 Teacher speaking…" : "🎤 Your turn — speak now!"}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Correction History Panel */}
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

        {connectionState === "idle" && !isComplete && (
          <div className="text-center py-12 space-y-3">
            <div className="text-5xl">🎙️</div>
            <p className="text-lg font-bold">Ready to practice!</p>
            <p className="text-muted-foreground">
              Tap "Start Talking" to begin a voice conversation with your AI teacher.
            </p>
          </div>
        )}

        {error && (
          <div className="text-center text-destructive font-semibold">{error}</div>
        )}

        {isConnected && isMuted && (
          <div className="text-center text-sm text-destructive font-semibold">🔇 Microphone muted — tap mic button to unmute</div>
        )}

        {/* AI Subtitles only — no student transcripts displayed */}
        {transcripts.filter((t) => t.role === "assistant").map((t, i) => {
          let mainText = t.text;
          let koreanHint: string | null = null;
          const koMatch = t.text.match(/\[KO:\s*(.+?)\]/);
          if (koMatch) {
            koreanHint = koMatch[1];
            mainText = t.text.replace(/\[KO:\s*.+?\]/g, "").trim();
          }
          return (
            <div key={i} className="flex justify-start">
              <Card className="max-w-[85%] rounded-2xl kid-shadow">
                <CardContent className="pt-3 pb-3 px-4">
                  <p className="text-sm font-semibold mb-1">🤖 Teacher</p>
                  <p className="text-base whitespace-pre-wrap">{mainText}</p>
                  {koreanHint && (
                    <p className="text-sm text-muted-foreground mt-1 border-t pt-1">🇰🇷 {koreanHint}</p>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Silence Timer */}
      {isConnected && !isMuted && !aiSpeaking && !speechDetected && (
        <div className="flex justify-center pb-2">
          <SilenceTimer active durationMs={3000} />
        </div>
      )}

      {/* Controls */}
      <div className="border-t p-4">
        {isComplete ? (
          <Button onClick={() => navigate("/")} className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow">
            🎉 Great Job! Go Back
          </Button>
        ) : connectionState === "idle" ? (
          <Button onClick={connect} className="w-full h-16 text-lg font-bold rounded-2xl kid-shadow gap-2">
            <Mic className="h-6 w-6" /> Start Talking 🎤
          </Button>
        ) : (
          <div className="flex gap-3 justify-center">
            <Button
              onClick={toggleMute}
              variant={isMuted ? "destructive" : "outline"}
              className="h-16 w-16 rounded-2xl kid-shadow"
              disabled={!isConnected || aiSpeaking}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button
              onClick={() => { disconnect(); navigate("/"); }}
              variant="destructive"
              className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2"
            >
              <PhoneOff className="h-6 w-6" /> Stop
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
