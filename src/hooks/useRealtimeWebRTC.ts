import { useState, useRef, useCallback, useEffect } from "react";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "error";

export type ConversationState = "IDLE" | "AI_SPEAKING" | "STUDENT_SPEAKING";

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  streaming?: boolean;
};

type ConnectOptions = {
  instructions?: string;
  voice?: string;
  turnDetection?: Record<string, unknown>;
  inputAudioTranscription?: Record<string, unknown>;
  speed?: string;
  /** Called for each streaming text delta from the assistant */
  onAiTextDelta?: (delta: string) => void;
  /** Called when a complete assistant transcript is finalized */
  onAiTranscriptDone?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onReady?: (sendText: (text: string) => void) => void;
  onStateChange?: (state: ConversationState) => void;
};

/**
 * Pure event-driven WebRTC hook for OpenAI Realtime.
 * State machine: IDLE → AI_SPEAKING ↔ STUDENT_SPEAKING
 * NO timers. NO intervals. All transitions driven by server events.
 */
export function useRealtimeWebRTC() {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState>("IDLE");
  const [speechDetected, setSpeechDetected] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const callbacksRef = useRef<ConnectOptions>({});
  const convStateRef = useRef<ConversationState>("IDLE");
  const remoteStreamRef = useRef<MediaStream | null>(null);

  // ── Helpers ──

  const setConvState = useCallback((state: ConversationState) => {
    convStateRef.current = state;
    setConversationState(state);
    callbacksRef.current.onStateChange?.(state);
    console.log(`[state] → ${state} t=${Date.now()}`);
  }, []);

  const muteMic = useCallback((mute: boolean) => {
    const trk = streamRef.current?.getAudioTracks()[0];
    if (trk) trk.enabled = !mute;
  }, []);

  // ── Mic management ──

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    const existing = streamRef.current;
    if (existing && existing.getAudioTracks().length > 0 && existing.getAudioTracks()[0].readyState !== "ended") {
      return existing;
    }
    try {
      const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (perm.state === "denied") throw new Error("Microphone permission denied.");
    } catch (e: any) { if (e.message?.includes("denied")) throw e; }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStorage.setItem("micPermissionGranted", "true");
    streamRef.current = stream;
    return stream;
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (track) {
      track.enabled = enabled;
      if (enabled) setSpeechDetected(false);
    }
  }, []);

  const setSpeakerMuted = useCallback((muted: boolean) => {
    if (audioRef.current) audioRef.current.muted = muted;
  }, []);

  // ── Send text ──

  const sendUserText = useCallback((text: string, force = false) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (!force && convStateRef.current === "AI_SPEAKING") return;

    muteMic(true);

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));

    console.log(`[debug] SENT_RESPONSE_CREATE t=${Date.now()}`);
    dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));

    setConvState("AI_SPEAKING");
    setSpeechDetected(false);
  }, [setConvState, muteMic]);

  // ── Connect ──

  const connect = useCallback(async (options: ConnectOptions = {}) => {
    callbacksRef.current = options;
    setStatus("connecting");
    setError(null);
    console.log(`[debug] START_CLICK t=${Date.now()}`);

    try {
      // 1. Chrome audio unlock
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();

      const audio = document.createElement("audio");
      audio.autoplay = true;
      (audio as any).playsInline = true;
      document.body.appendChild(audio);
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      try { await audio.play(); } catch {}
      audio.src = "";
      audioRef.current = audio;

      // 2. Mic
      const stream = await ensureMic();
      stream.getAudioTracks().forEach((t) => { t.enabled = false; });

      // 3. Ephemeral token
      const tokenRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            voice: options.voice || "alloy",
            instructions: options.instructions || "You are an energetic English teacher.",
            turn_detection: options.turnDetection || { type: "server_vad", threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: 3000 },
            input_audio_transcription: options.inputAudioTranscription || { model: "gpt-4o-mini-transcribe" },
            speed: options.speed || "medium",
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

      // 4. RTCPeerConnection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        audio.srcObject = e.streams[0];
        audio.play().then(() => {
          console.log(`[debug] AUDIO_PLAY_STARTED t=${Date.now()}`);
        }).catch((err) => {
          console.error(`[debug] AUDIO_PLAY_FAILED t=${Date.now()}`, err);
        });
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        console.log(`[debug] DC_OPEN t=${Date.now()}`);
        callbacksRef.current.onReady?.((text: string) => sendUserText(text, true));
      };

      dc.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          const type = ev.type as string;

          // ── Barge-in: student starts speaking ──
          if (type === "input_audio_buffer.speech_started") {
            console.log(`[debug] SPEECH_STARTED t=${Date.now()}`);
            setSpeechDetected(true);

            if (convStateRef.current === "AI_SPEAKING") {
              // Stop audio playback
              if (audioRef.current?.srcObject) {
                audioRef.current.pause();
                audioRef.current.srcObject = null;
              }
              // Cancel server-side response
              const d = dcRef.current;
              if (d && d.readyState === "open") {
                d.send(JSON.stringify({ type: "response.cancel" }));
              }
            }

            setConvState("STUDENT_SPEAKING");
            muteMic(false);
          }

          // ── Student speech ended → server VAD auto-creates response ──
          if (type === "input_audio_buffer.speech_stopped") {
            console.log(`[debug] SPEECH_STOPPED t=${Date.now()}`);
            setConvState("AI_SPEAKING");
            muteMic(true);
          }

          // ── Streaming text delta from assistant ──
          if (type === "response.text.delta" && ev.delta) {
            callbacksRef.current.onAiTextDelta?.(ev.delta);
          }

          // ── Also handle audio_transcript delta for streaming subtitles ──
          if (type === "response.audio_transcript.delta" && ev.delta) {
            callbacksRef.current.onAiTextDelta?.(ev.delta);
          }

          // ── Full transcript done ──
          if (type === "response.audio_transcript.done" && ev.transcript) {
            console.log(`[debug] GOT_AI_TRANSCRIPT_DONE t=${Date.now()}`);
            callbacksRef.current.onAiTranscriptDone?.(ev.transcript.trim());
          }

          // ── Audio delta (just for logging) ──
          if (type === "response.audio.delta") {
            // Re-attach audio if cleared by barge-in
            if (audioRef.current && !audioRef.current.srcObject && remoteStreamRef.current) {
              audioRef.current.srcObject = remoteStreamRef.current;
              audioRef.current.play().catch(() => {});
            }
            if (convStateRef.current !== "AI_SPEAKING") setConvState("AI_SPEAKING");
          }

          // ── response.done → transition to IDLE, open mic ──
          if (type === "response.done") {
            console.log(`[debug] GOT_RESPONSE_DONE t=${Date.now()}`);
            setConvState("IDLE");
            muteMic(false);
            setSpeechDetected(false);
          }

          // ── User transcript ──
          if (type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
            callbacksRef.current.onUserTranscript?.(ev.transcript.trim());
          }
        } catch {}
      };

      // 6. SDP exchange
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const model = session.model || "gpt-4o-mini-realtime-preview";
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${model}`,
        { method: "POST", headers: { Authorization: `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" }, body: offer.sdp }
      );
      if (!sdpRes.ok) throw new Error(`SDP exchange failed: ${sdpRes.status}`);

      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
      setStatus("connected");
      setConvState("AI_SPEAKING");

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setStatus("error");
          setError("Connection lost");
        }
      };
    } catch (e: any) {
      console.error("WebRTC connect error:", e);
      setStatus("error");
      setError(e.message || "Failed to connect");
    }
  }, [ensureMic, sendUserText, setConvState, muteMic]);

  // ── Disconnect ──

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    remoteStreamRef.current = null;
    convStateRef.current = "IDLE";
    setStatus("idle");
    setConversationState("IDLE");
    setSpeechDetected(false);
  }, []);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    status,
    error,
    conversationState,
    isAiSpeaking: conversationState === "AI_SPEAKING",
    speechDetected,
    connect,
    disconnect,
    ensureMic,
    setMicEnabled,
    setSpeakerMuted,
    sendUserText,
  };
}
