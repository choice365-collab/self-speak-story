import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useRealtimeWebRTC } from "@/hooks/useRealtimeWebRTC";

export default function VoiceChat() {
  const navigate = useNavigate();
  const { state, events, isMuted, error, connect, disconnect, toggleMute } =
    useRealtimeWebRTC();

  const isConnected = state === "connected";
  const isConnecting = state === "connecting";

  // Filter to show meaningful events
  const visibleEvents = events.filter((e) =>
    [
      "session_created",
      "connected",
      "disconnected",
      "error",
      "response.audio_transcript.done",
      "conversation.item.input_audio_transcription.completed",
      "response.done",
    ].includes(e.type)
  );

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => navigate("/")}
          className="rounded-xl"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-black">🎙️ Voice Chat</h1>
          <p className="text-sm text-muted-foreground">
            Realtime speech-to-speech
          </p>
        </div>
        <Badge
          variant="outline"
          className={`ml-auto rounded-full text-xs ${
            isConnected
              ? "border-secondary text-secondary"
              : state === "error"
              ? "border-destructive text-destructive"
              : ""
          }`}
        >
          {state}
        </Badge>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 gap-8">
        {/* Visualizer orb */}
        <div
          className={`relative w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 ${
            isConnected
              ? "bg-secondary/20 shadow-[0_0_60px_hsl(var(--secondary)/0.3)]"
              : isConnecting
              ? "bg-primary/20 animate-pulse"
              : "bg-muted"
          }`}
        >
          <div
            className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-500 ${
              isConnected
                ? "bg-secondary/30"
                : isConnecting
                ? "bg-primary/30"
                : "bg-muted-foreground/10"
            }`}
          >
            <span className="text-5xl">
              {isConnected ? "🗣️" : isConnecting ? "⏳" : "🎙️"}
            </span>
          </div>
          {isConnected && (
            <div className="absolute inset-0 rounded-full border-2 border-secondary/40 animate-ping" />
          )}
        </div>

        {/* Status text */}
        <div className="text-center space-y-1">
          <p className="text-lg font-bold">
            {isConnected
              ? "Listening… speak naturally!"
              : isConnecting
              ? "Connecting to AI…"
              : error
              ? "Connection failed"
              : "Ready to chat"}
          </p>
          {error && (
            <p className="text-sm text-destructive font-semibold">{error}</p>
          )}
          {isConnected && isMuted && (
            <p className="text-sm text-muted-foreground font-semibold">
              🔇 Microphone muted
            </p>
          )}
        </div>

        {/* Transcript events */}
        {visibleEvents.length > 0 && (
          <Card className="w-full rounded-2xl kid-shadow max-h-48 overflow-y-auto">
            <CardContent className="pt-4 pb-4 px-4 space-y-2">
              {visibleEvents.slice(-5).map((evt, i) => (
                <div key={i} className="text-sm">
                  <span className="text-muted-foreground font-mono text-xs">
                    {new Date(evt.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  <span className="font-semibold">
                    {evt.type === "response.audio_transcript.done"
                      ? `🤖 ${evt.data?.transcript || "AI spoke"}`
                      : evt.type ===
                        "conversation.item.input_audio_transcription.completed"
                      ? `🎤 ${evt.data?.transcript || "You spoke"}`
                      : evt.type}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Controls */}
      <div className="border-t p-4">
        <div className="flex gap-3 justify-center">
          {!isConnected && !isConnecting ? (
            <Button
              onClick={() => connect()}
              className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2"
            >
              <Phone className="h-6 w-6" /> Start Conversation
            </Button>
          ) : (
            <>
              <Button
                onClick={toggleMute}
                variant={isMuted ? "destructive" : "outline"}
                className="h-16 w-16 rounded-2xl kid-shadow"
                disabled={!isConnected}
              >
                {isMuted ? (
                  <MicOff className="h-6 w-6" />
                ) : (
                  <Mic className="h-6 w-6" />
                )}
              </Button>
              <Button
                onClick={disconnect}
                variant="destructive"
                className="h-16 px-8 text-lg font-bold rounded-2xl kid-shadow gap-2"
              >
                <PhoneOff className="h-6 w-6" /> End
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
