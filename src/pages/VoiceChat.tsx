import { useRef, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ArrowLeft, Mic, MicOff, PhoneOff, Bug } from "lucide-react";
import { useRealtimeWebRTC, TranscriptEntry } from "@/hooks/useRealtimeWebRTC";

export default function VoiceChat() {
  const navigate = useNavigate();
  const [showDebug, setShowDebug] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const {
    state,
    error,
    isMuted,
    transcripts,
    partialTranscript,
    debugLog,
    connect,
    disconnect,
    toggleMute,
  } = useRealtimeWebRTC();

  const isConnected = state === "connected";
  const isConnecting = state === "connecting";
  const isIdle = state === "disconnected" || state === "error";

  // Auto-scroll transcripts
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts, partialTranscript]);

  const statusColor = {
    disconnected: "bg-muted text-muted-foreground",
    connecting: "bg-accent/20 text-accent",
    connected: "bg-secondary/20 text-secondary",
    error: "bg-destructive/20 text-destructive",
  }[state];

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-xl shrink-0">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-black truncate">🎙️ Voice Chat</h1>
        </div>
        <Badge className={`rounded-full text-xs font-bold px-3 ${statusColor}`}>
          {state === "disconnected" ? "Ready" : state.charAt(0).toUpperCase() + state.slice(1)}
        </Badge>
        <Button variant="ghost" size="icon" onClick={() => setShowDebug(!showDebug)} className="rounded-xl shrink-0">
          <Bug className="h-4 w-4" />
        </Button>
      </header>

      {/* Transcript area */}
      <ScrollArea className="flex-1 px-4 py-4">
        <div className="space-y-3 min-h-[200px]">
          {transcripts.length === 0 && !partialTranscript && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <span className="text-6xl mb-4">{isConnected ? "🗣️" : "🎙️"}</span>
              <p className="text-lg font-bold text-foreground">
                {isConnected ? "Listening… speak naturally!" : "Tap Start to begin"}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isConnected ? "Your words will appear here in real-time" : "Have a real conversation with AI in English"}
              </p>
            </div>
          )}

          {transcripts.map((entry, i) => (
            <TranscriptBubble key={i} entry={entry} />
          ))}

          {partialTranscript && (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-md px-4 py-2.5 bg-primary/10 text-foreground text-sm font-semibold animate-pulse">
                {partialTranscript}…
              </div>
            </div>
          )}

          <div ref={transcriptEndRef} />
        </div>
      </ScrollArea>

      {/* Error */}
      {error && (
        <div className="px-4 pb-2">
          <div className="rounded-xl bg-destructive/10 text-destructive text-sm font-semibold px-4 py-2 text-center">
            {error}
          </div>
        </div>
      )}

      {/* Debug panel */}
      {showDebug && (
        <div className="border-t border-border px-4 py-2 max-h-36 overflow-y-auto bg-muted/50">
          <p className="text-xs font-bold text-muted-foreground mb-1">Debug Log</p>
          {debugLog.slice(-10).map((d, i) => (
            <p key={i} className="text-xs text-muted-foreground font-mono leading-relaxed">
              <span className="opacity-60">{new Date(d.timestamp).toLocaleTimeString()}</span>{" "}
              <span className="font-semibold text-foreground">{d.label}</span>
              {d.detail && <span className="opacity-70"> — {d.detail}</span>}
            </p>
          ))}
          {debugLog.length === 0 && <p className="text-xs text-muted-foreground">No events yet</p>}
        </div>
      )}

      {/* Controls */}
      <div className="border-t border-border p-4 pb-6 safe-area-bottom">
        <div className="flex gap-3 justify-center">
          {isIdle ? (
            <Button
              onClick={() => connect()}
              disabled={isConnecting}
              className="h-16 px-10 text-lg font-black rounded-2xl kid-shadow-lg gap-3"
            >
              <Mic className="h-6 w-6" />
              Start
            </Button>
          ) : (
            <>
              <Button
                onClick={toggleMute}
                variant={isMuted ? "destructive" : "outline"}
                className="h-16 w-16 rounded-2xl kid-shadow"
                disabled={!isConnected}
              >
                {isMuted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
              </Button>
              <Button
                onClick={disconnect}
                variant="destructive"
                className="h-16 px-10 text-lg font-black rounded-2xl kid-shadow-lg gap-3"
              >
                <PhoneOff className="h-6 w-6" />
                Stop
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
          isUser
            ? "bg-primary text-primary-foreground rounded-br-md"
            : "bg-muted text-foreground rounded-bl-md"
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
