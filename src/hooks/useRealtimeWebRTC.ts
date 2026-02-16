import { useState, useRef, useCallback, useEffect } from "react";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";
export type MicStatus = "checking" | "ready" | "needs_permission" | "denied";

export type TranscriptEntry = {
  role: "user" | "ai";
  text: string;
  final: boolean;
  timestamp: number;
};

export type DebugEntry = {
  label: string;
  timestamp: number;
  detail?: string;
};

export function useRealtimeWebRTC() {
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [partialTranscript, setPartialTranscript] = useState<string>("");
  const [debugLog, setDebugLog] = useState<DebugEntry[]>([]);
  const [micStatus, setMicStatus] = useState<MicStatus>("checking");

  // Check mic permission on mount without triggering a prompt
  useEffect(() => {
    async function checkMic() {
      try {
        const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (result.state === "granted") {
          setMicStatus("ready");
          localStorage.setItem("micPermissionGranted", "true");
        } else if (result.state === "denied") {
          setMicStatus("denied");
          localStorage.removeItem("micPermissionGranted");
        } else {
          setMicStatus(localStorage.getItem("micPermissionGranted") === "true" ? "ready" : "needs_permission");
        }
        result.addEventListener("change", () => {
          if (result.state === "granted") { setMicStatus("ready"); localStorage.setItem("micPermissionGranted", "true"); }
          else if (result.state === "denied") { setMicStatus("denied"); localStorage.removeItem("micPermissionGranted"); }
          else { setMicStatus("needs_permission"); }
        });
      } catch {
        // Fallback if permissions API not supported
        setMicStatus(localStorage.getItem("micPermissionGranted") === "true" ? "ready" : "needs_permission");
      }
    }
    checkMic();
  }, []);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const aiSpeakingRef = useRef(false);

  const addDebug = useCallback((label: string, detail?: string) => {
    setDebugLog((prev) => [...prev.slice(-29), { label, timestamp: Date.now(), detail }]);
  }, []);

  const connect = useCallback(async (options?: { model?: string; voice?: string; instructions?: string }) => {
    setState("connecting");
    setError(null);
    setTranscripts([]);
    setPartialTranscript("");
    addDebug("Requesting microphone…");

    try {
      // 1. Check permission state before requesting mic
      let stream: MediaStream;
      try {
        const permStatus = await navigator.permissions.query({ name: "microphone" as PermissionName });
        if (permStatus.state === "denied") {
          throw new Error("Microphone permission denied. Please enable it in browser settings.");
        }
      } catch (permErr: any) {
        if (permErr.message?.includes("denied")) throw permErr;
        // permissions API not supported — fall through
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        localStorage.setItem("micPermissionGranted", "true");
      } catch (micErr: any) {
        localStorage.removeItem("micPermissionGranted");
        throw new Error("Please enable microphone access in your browser settings.");
      }
      streamRef.current = stream;
      addDebug("Microphone granted");

      // 2. Get ephemeral token
      const tokenRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            model: options?.model || "gpt-4o-mini-realtime-preview",
            voice: options?.voice || "alloy",
            instructions: options?.instructions || "You are a friendly English conversation partner. Speak only in English. Be encouraging and patient. Keep responses concise.",
            turn_detection: { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 500 },
            input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
          }),
        }
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.json().catch(() => ({}));
        throw new Error(err.error || `Token request failed: ${tokenRes.status}`);
      }

      const session = await tokenRes.json();
      const ephemeralKey = session.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key returned");
      addDebug("Token received", `session: ${session.id?.slice(0, 12)}…`);

      // 3. WebRTC peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        addDebug("AI audio track received");
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => addDebug("Data channel open");

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          handleServerEvent(event);
        } catch {
          // ignore
        }
      };

      // 5. SDP exchange
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${options?.model || "gpt-4o-mini-realtime-preview"}`,
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

      setState("connected");
      addDebug("WebRTC connected");

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setState("error");
          setError("Connection lost");
          addDebug("Connection lost", pc.connectionState);
        }
      };
    } catch (e: any) {
      console.error("WebRTC connect error:", e);
      setState("error");
      setError(e.message || "Failed to connect");
      addDebug("Error", e.message);
      // Cleanup stream on error
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }, [addDebug]);

  const handleServerEvent = useCallback((event: any) => {
    const type = event.type as string;

    switch (type) {
      // User speech detected → barge-in: cancel AI response
      case "input_audio_buffer.speech_started":
        addDebug("User speaking…");
        if (aiSpeakingRef.current) {
          // Barge-in: cancel ongoing AI response
          const dc = dcRef.current;
          if (dc?.readyState === "open") {
            dc.send(JSON.stringify({ type: "response.cancel" }));
            addDebug("Barge-in → response.cancel sent");
          }
          aiSpeakingRef.current = false;
        }
        break;

      case "input_audio_buffer.speech_stopped":
        addDebug("User stopped speaking");
        break;

      // Live partial transcript of user speech
      case "conversation.item.input_audio_transcription.completed":
        {
          const text = event.transcript?.trim();
          if (text) {
            setPartialTranscript("");
            setTranscripts((prev) => [...prev, { role: "user", text, final: true, timestamp: Date.now() }]);
            addDebug("User transcript", text.slice(0, 40));
          }
        }
        break;

      // AI started generating audio
      case "response.audio.delta":
        aiSpeakingRef.current = true;
        break;

      // AI finished speaking - show transcript
      case "response.audio_transcript.done":
        {
          const text = event.transcript?.trim();
          if (text) {
            setTranscripts((prev) => [...prev, { role: "ai", text, final: true, timestamp: Date.now() }]);
            addDebug("AI transcript", text.slice(0, 40));
          }
          aiSpeakingRef.current = false;
        }
        break;

      case "response.done":
        aiSpeakingRef.current = false;
        break;

      case "error":
        addDebug("Server error", JSON.stringify(event.error)?.slice(0, 80));
        break;

      default:
        // Ignore other events
        break;
    }
  }, [addDebug]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    streamRef.current = null;
    aiSpeakingRef.current = false;
    setState("disconnected");
    setPartialTranscript("");
    addDebug("Disconnected by user");
  }, [addDebug]);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
      addDebug(track.enabled ? "Unmuted" : "Muted");
    }
  }, [addDebug]);

  return {
    state,
    error,
    isMuted,
    micStatus,
    transcripts,
    partialTranscript,
    debugLog,
    connect,
    disconnect,
    toggleMute,
  };
}
