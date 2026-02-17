import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Mic, MicOff, PhoneOff, BookOpen, Loader2 } from "lucide-react";
import { useRealtimeWebRTC, TranscriptEntry } from "@/hooks/useRealtimeWebRTC";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type LearnedExpression = {
  expression: string;
  ai_explanation: string;
  example_sentences: string[];
  learned_at: string;
};

export default function VoiceChat() {
  const navigate = useNavigate();
  const [userMuted, setUserMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingTextRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [todayHistory, setTodayHistory] = useState<LearnedExpression[]>([]);
  const [extracting, setExtracting] = useState(false);
  const transcriptsRef = useRef<TranscriptEntry[]>([]);

  const {
    status,
    error,
    isAiSpeaking,
    connect,
    disconnect,
    setMicEnabled,
  } = useRealtimeWebRTC();

  const isConnected = status === "connected";
  const isIdle = status === "idle" || status === "error";

  // Keep ref in sync
  useEffect(() => { transcriptsRef.current = transcripts; }, [transcripts]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, streamingText]);

  // Load today's history on mount
  useEffect(() => {
    loadTodayHistory();
  }, []);

  const loadTodayHistory = async () => {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("learning_history")
      .select("*")
      .eq("session_date", today)
      .order("learned_at", { ascending: false });
    if (data) setTodayHistory(data as LearnedExpression[]);
  };

  const extractAndSave = async () => {
    const currentTranscripts = transcriptsRef.current;
    if (currentTranscripts.length < 2) return;
    setExtracting(true);
    try {
      const res = await supabase.functions.invoke("extract-expressions", {
        body: { transcripts: currentTranscripts },
      });
      if (res.error) throw new Error(res.error.message);
      const count = res.data?.expressions?.length || 0;
      if (count > 0) {
        toast.success(`${count} expression${count > 1 ? "s" : ""} saved!`);
        await loadTodayHistory();
      } else {
        toast.info("No new expressions detected.");
      }
    } catch (e: any) {
      console.error("Extract error:", e);
      toast.error("Failed to save expressions");
    } finally {
      setExtracting(false);
    }
  };

  const FREE_CHAT_INSTRUCTIONS = `You are a warm, patient English conversation partner for a Korean-speaking child.

IMPORTANT RULES:
1. The student may speak in Korean to tell you what they learned today. You MUST understand their Korean input but ALWAYS respond in English only.
2. When the student mentions an expression or word (in Korean or English), teach it naturally:
   - Explain what it means through a vivid example or scenario (never translate directly)
   - Give 2-3 example sentences
   - Ask the student to try using it in a sentence
3. If the student makes a mistake, gently correct it within your natural response.
4. Keep responses short (2-4 sentences). This is a voice conversation, not a lecture.
5. Be encouraging and celebrate their efforts!
6. NEVER use Korean in your responses. All output must be 100% English.

Start by warmly greeting the student and asking: "Hey! What did you learn today? Tell me about it!"`;

  const handleStart = () => {
    streamingTextRef.current = "";
    setStreamingText("");
    connect({
      instructions: FREE_CHAT_INSTRUCTIONS,
      onAiTextDelta: (delta) => {
        streamingTextRef.current += delta;
        setStreamingText(streamingTextRef.current);
      },
      onAiTranscriptDone: (text) => {
        setTranscripts((prev) => [...prev, { role: "assistant", text, timestamp: Date.now() }]);
        streamingTextRef.current = "";
        setStreamingText("");
      },
      onUserTranscript: (text) => setTranscripts((prev) => [...prev, { role: "user", text, timestamp: Date.now() }]),
      onReady: () => {
        // AI will auto-greet based on instructions
      },
      onStateChange: (state) => {
        if (state === "STUDENT_SPEAKING") {
          streamingTextRef.current = "";
          setStreamingText("");
        }
        if (state === "IDLE" && !userMuted) setMicEnabled(true);
      },
    });
  };

  const handleStop = async () => {
    disconnect();
    await extractAndSave();
  };

  const toggleMute = () => {
    const next = !userMuted;
    setUserMuted(next);
    setMicEnabled(!next);
  };

  const statusColor = {
    idle: "bg-muted text-muted-foreground",
    connecting: "bg-accent/20 text-accent",
    connected: "bg-secondary/20 text-secondary",
    error: "bg-destructive/20 text-destructive",
  }[status];

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-2xl mx-auto">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => { disconnect(); navigate("/"); }} className="rounded-xl shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black truncate">🎙️ Voice Chat</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setShowHistory(!showHistory)}
          className={`rounded-xl shrink-0 ${showHistory ? "bg-primary/10" : ""}`}
        >
          <BookOpen className="h-5 w-5" />
        </Button>
        <Badge className={`rounded-full text-xs font-bold px-3 ${statusColor}`}>
          {status === "idle" ? "Ready" : status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      </header>

      {showHistory ? (
        <ScrollArea className="flex-1 px-4 py-4">
          <h2 className="text-base font-black mb-3">📚 Today's Expressions</h2>
          {todayHistory.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No expressions learned yet today. Start a chat!</p>
          ) : (
            <div className="space-y-3">
              {todayHistory.map((item, i) => (
                <div key={i} className="rounded-2xl bg-muted p-4 space-y-2">
                  <div className="font-black text-base text-foreground">{item.expression}</div>
                  {item.ai_explanation && (
                    <p className="text-sm text-muted-foreground">{item.ai_explanation}</p>
                  )}
                  {item.example_sentences && item.example_sentences.length > 0 && (
                    <ul className="space-y-1">
                      {item.example_sentences.map((ex, j) => (
                        <li key={j} className="text-sm text-foreground/80 pl-3 border-l-2 border-primary/30">{ex}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      ) : (
        <ScrollArea className="flex-1 px-4 py-4">
          <div className="space-y-3 min-h-[200px]">
            {transcripts.length === 0 && !streamingText && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <span className="text-6xl mb-4">{isConnected ? "🗣️" : "🎙️"}</span>
                <p className="text-lg font-bold text-foreground">
                  {isConnected ? "Listening… tell me what you learned!" : "Tap Start to begin"}
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  오늘 뭐 배웠는지 한글로 말해도 돼요!
                </p>
              </div>
            )}
            {transcripts.map((entry, i) => (
              <TranscriptBubble key={i} entry={entry} />
            ))}
            {streamingText && (
              <div className="flex justify-start">
                <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm font-semibold bg-muted text-foreground rounded-bl-md">
                  <span className="text-[10px] opacity-60 block mb-0.5">AI · streaming…</span>
                  {streamingText}<span className="animate-pulse">▌</span>
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        </ScrollArea>
      )}

      {extracting && (
        <div className="px-4 pb-2">
          <div className="rounded-xl bg-primary/10 text-primary text-sm font-semibold px-4 py-2 text-center flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Saving expressions...
          </div>
        </div>
      )}

      {error && (
        <div className="px-4 pb-2">
          <div className="rounded-xl bg-destructive/10 text-destructive text-sm font-semibold px-4 py-2 text-center">{error}</div>
        </div>
      )}

      <div className="border-t border-border p-4 pb-6 safe-area-bottom">
        <div className="flex gap-3 justify-center">
          {isIdle ? (
            <Button onClick={handleStart} className="h-16 px-10 text-lg font-black rounded-2xl kid-shadow-lg gap-3">
              <Mic className="h-6 w-6" /> Start
            </Button>
          ) : (
            <>
              <Button
                onClick={toggleMute}
                variant={userMuted ? "destructive" : "outline"}
                className="h-16 w-16 rounded-2xl kid-shadow"
                disabled={!isConnected || isAiSpeaking}
              >
                {userMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
              <Button
                onClick={handleStop}
                variant="destructive"
                className="h-16 px-10 text-lg font-black rounded-2xl kid-shadow-lg gap-3"
              >
                <PhoneOff className="h-6 w-6" /> Stop
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function TranscriptBubble({ entry }: { entry: TranscriptEntry }) {
  const isUser = entry.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm font-semibold ${
          isUser ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted text-foreground rounded-bl-md"
        }`}
      >
        <span className="text-[10px] opacity-60 block mb-0.5">
          {isUser ? "You" : "AI"} · {new Date(entry.timestamp).toLocaleTimeString()}
        </span>
        {entry.text}
      </div>
    </div>
  );
}
