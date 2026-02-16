import { useState, useRef, useCallback, useEffect } from "react";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "error";

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

type ConnectOptions = {
  instructions?: string;
  voice?: string;
  turnDetection?: Record<string, unknown>;
  inputAudioTranscription?: Record<string, unknown>;
  speed?: string;
  /** Called when AI transcript is finalized */
  onAiTranscript?: (text: string) => void;
  /** Called when user transcript is finalized */
  onUserTranscript?: (text: string) => void;
  /** Called right after data channel opens — send initial prompt here */
  onReady?: (sendText: (text: string) => void) => void;
  /** Called when AI starts speaking */
  onAiSpeakingStart?: () => void;
  /** Called when AI finishes speaking */
  onAiSpeakingEnd?: () => void;
};

/**
 * Single source of truth for OpenAI Realtime WebRTC.
 * Manages: mic stream, RTCPeerConnection, data channel, audio output.
 */
export function useRealtimeWebRTC() {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [speechDetected, setSpeechDetected] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const callbacksRef = useRef<ConnectOptions>({});
  const perfRef = useRef<Record<string, number>>({});

  // Perf logging
  const perf = useCallback((label: string) => {
    const now = performance.now();
    perfRef.current[label] = now;
    console.log(`[perf] ${label}: ${now.toFixed(1)}ms`);
  }, []);

  // ── Mic management (single getUserMedia) ──

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    const existing = streamRef.current;
    if (existing && existing.getAudioTracks().length > 0 && existing.getAudioTracks()[0].readyState !== "ended") {
      return existing;
    }
    // Check permission first
    try {
      const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (perm.state === "denied") {
        throw new Error("Microphone permission denied. Please enable it in browser settings.");
      }
    } catch (e: any) {
      if (e.message?.includes("denied")) throw e;
    }
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
      perf(enabled ? "mic_opened" : "mic_muted");
    }
  }, [perf]);

  const setSpeakerMuted = useCallback((muted: boolean) => {
    if (audioRef.current) {
      audioRef.current.muted = muted;
    }
  }, []);

  // ── Send text via data channel ──

  const sendUserText = useCallback((text: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    // Mute mic — AI will speak
    setMicEnabled(false);
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));
    dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));
    setIsAiSpeaking(true);
    setSpeechDetected(false);
  }, [setMicEnabled]);

  // ── Connect ──

  const connect = useCallback(async (options: ConnectOptions = {}) => {
    callbacksRef.current = options;
    setStatus("connecting");
    setError(null);
    perf("start_click");

    try {
      // 1. Chrome audio unlock (must be in user gesture)
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();
      perf("audio_ctx_resumed");

      // Create audio element & warm up in user gesture
      const audio = document.createElement("audio");
      audio.autoplay = true;
      (audio as any).playsInline = true;
      document.body.appendChild(audio);
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
      try { await audio.play(); } catch {}
      audio.src = "";
      audioRef.current = audio;

      // 2. Mic — reuse or acquire
      const stream = await ensureMic();
      // Mic OFF initially — AI speaks first
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
            instructions: options.instructions || "You are an energetic English teacher. You must speak only in English. Never use Korean. Never translate into Korean.",
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

      // Store remote stream for re-attachment after barge-in
      const remoteStreamRef = { current: null as MediaStream | null };

      pc.ontrack = (e) => {
        remoteStreamRef.current = e.streams[0];
        audio.srcObject = e.streams[0];
        audio.play().catch(() => {});
        perf("tts_play_started");
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      let firstChunkLogged = false;

      dc.onopen = () => {
        perf("dc_open");
        // Let the consumer send the first prompt
        callbacksRef.current.onReady?.(sendUserText);
        perf("first_ai_request_sent");
      };

      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          const type = event.type as string;

          // ── Barge-in: student speech interrupts AI ──
          if (type === "input_audio_buffer.speech_started") {
            setSpeechDetected(true);
            perf("speech_detected");

            // If AI is speaking, immediately stop playback
            if (audioRef.current?.srcObject) {
              // Pause and reset the audio element to kill TTS output
              audioRef.current.pause();
              audioRef.current.srcObject = null;
            }
            setIsAiSpeaking(false);

            // Truncate the in-flight AI response via data channel
            const truncateDc = dcRef.current;
            if (truncateDc && truncateDc.readyState === "open") {
              truncateDc.send(JSON.stringify({ type: "response.cancel" }));
            }

            // Ensure mic is fully open for student
            const micTrack = streamRef.current?.getAudioTracks()[0];
            if (micTrack) micTrack.enabled = true;
          }

          if (type === "input_audio_buffer.speech_stopped") {
            perf("end_of_speech");
          }

          // AI audio chunk
          if (type === "response.audio.delta") {
            if (!firstChunkLogged) { perf("first_tts_chunk_received"); firstChunkLogged = true; }
            // Re-attach audio if cleared by barge-in
            if (audioRef.current && !audioRef.current.srcObject && remoteStreamRef.current) {
              audioRef.current.srcObject = remoteStreamRef.current;
              audioRef.current.play().catch(() => {});
            }
            setIsAiSpeaking(true);
            setSpeechDetected(false);
            // Ensure mic off while AI speaks
            const trk = streamRef.current?.getAudioTracks()[0];
            if (trk) trk.enabled = false;
            callbacksRef.current.onAiSpeakingStart?.();
          }

          // AI transcript done
          if (type === "response.audio_transcript.done" && event.transcript) {
            callbacksRef.current.onAiTranscript?.(event.transcript.trim());
          }

          // AI response done → open mic
          if (type === "response.done") {
            setIsAiSpeaking(false);
            perf("tts_play_ended");
            firstChunkLogged = false;
            callbacksRef.current.onAiSpeakingEnd?.();
          }

          // User transcript
          if (type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
            callbacksRef.current.onUserTranscript?.(event.transcript.trim());
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
      perf("session_connected");

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
  }, [ensureMic, perf, sendUserText]);

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
    setStatus("idle");
    setIsAiSpeaking(false);
    setSpeechDetected(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    status,
    error,
    isAiSpeaking,
    speechDetected,
    connect,
    disconnect,
    ensureMic,
    setMicEnabled,
    setSpeakerMuted,
    sendUserText,
  };
}
