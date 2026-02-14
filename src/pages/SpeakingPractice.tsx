import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mic, MicOff, PhoneOff, CheckCircle } from "lucide-react";

type VerbData = {
  verb_key: string;
  base_verb: string;
  meaning_en: string | null;
  example_short_1: string | null;
  example_short_2: string | null;
  example_short_3: string | null;
  example_long_1: string | null;
  example_long_2: string | null;
  example_long_3: string | null;
  situation_1: string | null;
  situation_2: string | null;
  situation_3: string | null;
  situation_4: string | null;
  situation_5: string | null;
};

type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

const REQUIRED_PASSES = 3;
const TARGET_SECONDS = 300;

function buildSystemInstructions(verb: VerbData): string {
  const situations = [verb.situation_1, verb.situation_2, verb.situation_3, verb.situation_4, verb.situation_5].filter(Boolean);
  const examples = [verb.example_short_1, verb.example_short_2, verb.example_short_3].filter(Boolean);
  const longExamples = [verb.example_long_1, verb.example_long_2, verb.example_long_3].filter(Boolean);

  return `You are a friendly, encouraging English teacher helping a Korean student practice speaking English.
You ONLY speak English. Keep your language simple and clear. Speak at a slightly slow pace.

The student is learning the phrasal verb: "${verb.base_verb}"
Meaning: ${verb.meaning_en || ""}

SHORT EXAMPLES: ${examples.join(" / ")}
LONG EXAMPLES: ${longExamples.join(" / ")}
PRACTICE SITUATIONS: ${situations.join(" / ")}

YOUR TEACHING FLOW:
1. FIRST, greet the student warmly and briefly explain what "${verb.base_verb}" means in simple English. Give 2-3 short example sentences.
2. THEN, pick one situation from the list above and ask the student to make a sentence using "${verb.base_verb}".
3. WHEN the student responds:
   - Always acknowledge their effort positively
   - If there are mistakes, gently correct them and give the corrected sentence
   - Ask them to try again with the correction
   - If correct, praise them enthusiastically and move to the next situation
4. REPEAT with different situations. After 3 successful uses, congratulate them and say "PRACTICE COMPLETE!"

IMPORTANT RULES:
- Keep each response SHORT (2-3 sentences max)
- Be very encouraging and patient
- If the student seems stuck, give hints
- Always bring the conversation back to practicing "${verb.base_verb}"
- When the student successfully uses the verb correctly 3 times, say exactly "PRACTICE COMPLETE!" at the end of your response
- Do NOT switch to Korean. Always respond in English.`;
}

export default function SpeakingPractice() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [verbData, setVerbData] = useState<VerbData | null>(null);
  const [connectionState, setConnectionState] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionStart] = useState(Date.now());

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const totalAudioSecondsRef = useRef(0);
  const sessionStartTimeRef = useRef(Date.now());

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
    const limitSeconds = (profile?.daily_quota_minutes || 10) * 60;
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

  const addTranscript = useCallback((role: "user" | "assistant", text: string) => {
    setTranscripts((prev) => [...prev, { role, text, timestamp: Date.now() }]);
  }, []);

  const connect = useCallback(async () => {
    if (!verbData) return;
    setConnectionState("connecting");
    setError(null);

    try {
      const instructions = buildSystemInstructions(verbData);

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
            turn_detection: { type: "server_vad" },
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

      // Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      // Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);

          // Capture completed transcripts
          if (event.type === "response.audio_transcript.done" && event.transcript) {
            addTranscript("assistant", event.transcript);

            // Check for completion signal
            if (event.transcript.includes("PRACTICE COMPLETE")) {
              handleCompletion();
            }
          }
          if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
            addTranscript("user", event.transcript);
            // Track audio seconds
            totalAudioSecondsRef.current += 5; // approximate per turn
          }
        } catch {}
      };

      // SDP exchange
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
  }, [verbData, addTranscript]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    streamRef.current = null;
    if (connectionState === "connected") {
      setConnectionState("idle");
    }
  }, [connectionState]);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
    }
  }, []);

  const handleCompletion = async () => {
    setIsComplete(true);
    const totalSessionSeconds = Math.floor((Date.now() - sessionStart) / 1000);

    // Update daily usage
    await updateDailyUsage(totalAudioSecondsRef.current);

    // Mark assignment complete
    await supabase.from("assignments")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", assignmentId);

    // Record speaking session
    if (user) {
      await supabase.from("speaking_sessions").insert({
        student_id: user.id,
        assignment_id: assignmentId,
        duration_seconds: totalSessionSeconds,
      });
    }

    // Disconnect after a short delay
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
          <h1 className="text-xl font-black capitalize">🗣️ {verbData.base_verb}</h1>
          <p className="text-sm text-muted-foreground">{verbData.meaning_en}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
        {/* Visualizer */}
        {(isConnected || isConnecting) && (
          <div className="flex justify-center py-6">
            <div
              className={`relative w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
                isConnected
                  ? "bg-secondary/20 shadow-[0_0_40px_hsl(var(--secondary)/0.3)]"
                  : "bg-primary/20 animate-pulse"
              }`}
            >
              <span className="text-4xl">{isConnected ? "🗣️" : "⏳"}</span>
              {isConnected && (
                <div className="absolute inset-0 rounded-full border-2 border-secondary/40 animate-ping" />
              )}
            </div>
          </div>
        )}

        {/* Status message before connection */}
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
          <div className="text-center text-sm text-muted-foreground font-semibold">🔇 Microphone muted</div>
        )}

        {/* Transcripts */}
        {transcripts.map((t, i) => (
          <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
            <Card className={`max-w-[85%] rounded-2xl ${t.role === "user" ? "bg-primary text-primary-foreground" : "kid-shadow"}`}>
              <CardContent className="pt-3 pb-3 px-4">
                <p className="text-sm font-semibold mb-1">{t.role === "user" ? "🎤 You" : "🤖 Teacher"}</p>
                <p className="text-base whitespace-pre-wrap">{t.text}</p>
              </CardContent>
            </Card>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

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
              disabled={!isConnected}
            >
              {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            <Button
              onClick={() => { disconnect(); setConnectionState("idle"); }}
              variant="destructive"
              className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2"
            >
              <PhoneOff className="h-6 w-6" /> End
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
