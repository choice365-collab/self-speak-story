import { useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Mic, MicOff, PhoneOff } from "lucide-react";
import { useRealtimeWebRTC, TranscriptEntry } from "@/hooks/useRealtimeWebRTC";

export default function VoiceChat() {
  const navigate = useNavigate();
  const [userMuted, setUserMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [streamingText, setStreamingText] = useState("");
  const streamingTextRef = useRef("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, streamingText]);

  const handleStart = () => {
    streamingTextRef.current = "";
    setStreamingText("");
    connect({
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
      onReady: (send) => send("Say hello and introduce yourself as an English conversation partner."),
      onStateChange: (state) => {
        // Clear streaming buffer on barge-in
        if (state === "STUDENT_SPEAKING") {
          streamingTextRef.current = "";
          setStreamingText("");
        }
        if (state === "IDLE" && !userMuted) setMicEnabled(true);
      },
    });
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
        <Badge className={`rounded-full text-xs font-bold px-3 ${statusColor}`}>
          {status === "idle" ? "Ready" : status.charAt(0).toUpperCase() + status.slice(1)}
        </Badge>
      </header>

      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-3 min-h-[200px]">
          {transcripts.length === 0 && !streamingText && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="text-6xl mb-4">{isConnected ? "🗣️" : "🎙️"}</span>
              <p className="text-lg font-bold text-foreground">
                {isConnected ? "Listening… speak naturally!" : "Tap Start to begin"}
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
                className={cn(
                  "h-16 w-16 rounded-2xl kid-shadow cursor-pointer",
                  userMuted
                    ? "hover:!bg-destructive hover:!text-destructive-foreground active:!bg-destructive"
                    : "hover:!bg-background hover:!text-foreground active:!bg-background"
                )}
                disabled={!isConnected || isAiSpeaking}
              >
                {userMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
              <Button
                onClick={() => { disconnect(); }}
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
