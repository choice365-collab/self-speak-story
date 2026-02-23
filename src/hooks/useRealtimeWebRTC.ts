import { useState, useRef, useCallback, useEffect } from "react";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "error";
export type ConversationState = "IDLE" | "AI_SPEAKING" | "STUDENT_SPEAKING";

export type TranscriptEntry = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
};

type ConnectOptions = {
  instructions?: string;
  voice?: string;
  preUnlockedAudio?: HTMLAudioElement;
  turnDetection?: Record<string, unknown>;
  inputAudioTranscription?: Record<string, unknown>;
  speed?: string;
  onAiTextDelta?: (delta: string) => void;
  onAiTranscriptDone?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onReady?: (sendText: (text: string) => void) => void;
  onStateChange?: (state: ConversationState) => void;
};

/**
 * Pure event-driven WebRTC hook for OpenAI Realtime.
 * NO timers. NO intervals. All transitions from server events only.
 */
export function useRealtimeWebRTC() {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState>("IDLE");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const callbacksRef = useRef<ConnectOptions>({});
  const convStateRef = useRef<ConversationState>("IDLE");
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const bargeInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastBargeInRef = useRef<number>(0);
  const audioHealAttemptedRef = useRef(false);
  const silentDeltaCountRef = useRef(0);

  // ── Helpers ──

  const healAudio = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Layer ①: restore volume (use volume instead of muted to keep playback active on mobile)
    audio.muted = false;
    audio.volume = 1;
    // Layer ②: re-attach srcObject if lost
    if (!audio.srcObject && remoteStreamRef.current) {
      console.log("[heal] re-attaching srcObject");
      audio.srcObject = remoteStreamRef.current;
    }
    // Force play if paused
    if (audio.paused) {
      audio.play().catch((err) => console.error("[heal] play() rejected:", err));
    }
  }, []);

  const setConvState = useCallback((state: ConversationState) => {
    convStateRef.current = state;
    setConversationState(state);
    callbacksRef.current.onStateChange?.(state);
    // Reset silent delta counter on any state change
    silentDeltaCountRef.current = 0;
    console.log(`[state] → ${state}`);
  }, []);

  const setMicTrackEnabled = useCallback((enabled: boolean) => {
    const trk = streamRef.current?.getAudioTracks()[0];
    if (trk) trk.enabled = enabled;
  }, []);

  // ── Mic ──

  const ensureMic = useCallback(async (): Promise<MediaStream> => {
    const existing = streamRef.current;
    if (existing && existing.getAudioTracks().length > 0 && existing.getAudioTracks()[0].readyState !== "ended") {
      return existing;
    }
    try {
      const perm = await navigator.permissions.query({ name: "microphone" as PermissionName });
      if (perm.state === "denied") throw new Error("Microphone permission denied.");
    } catch (e: any) { if (e.message?.includes("denied")) throw e; }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    localStorage.setItem("micPermissionGranted", "true");
    streamRef.current = stream;
    return stream;
  }, []);

  const setMicEnabled = useCallback((enabled: boolean) => {
    setMicTrackEnabled(enabled);
  }, [setMicTrackEnabled]);

  const setSpeakerMuted = useCallback((muted: boolean) => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : 1;
  }, []);

  // ── Send text (for initial prompt / Korean handling) ──

  const sendUserText = useCallback((text: string, force = false) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    if (!force && convStateRef.current === "AI_SPEAKING") return;

    setMicTrackEnabled(false);

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));
    console.log("[debug] sent response.create");
    dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));

    setConvState("AI_SPEAKING");
  }, [setConvState, setMicTrackEnabled]);

  /** Send session.update to replace system instructions mid-session */
  const sendSessionUpdate = useCallback((newInstructions: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;
    dc.send(JSON.stringify({
      type: "session.update",
      session: { instructions: newInstructions },
    }));
    console.log("[session.update] instructions replaced for Phase 3");
  }, []);

  // ── Connect ──

  const connect = useCallback(async (options: ConnectOptions = {}) => {
    callbacksRef.current = options;
    setStatus("connecting");
    setError(null);

    try {
      // 1. Audio setup — reuse pre-unlocked element if provided
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume();

      let audio: HTMLAudioElement;
      if (options.preUnlockedAudio) {
        // Reuse the audio element that was already unlocked in user gesture context
        audio = options.preUnlockedAudio;
        console.log("[audio] reusing pre-unlocked audio element");
      } else {
        // Fallback: create new element (may fail on mobile)
        audio = document.createElement("audio");
        audio.autoplay = true;
        (audio as any).playsInline = true;
        document.body.appendChild(audio);
        audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        try { await audio.play(); } catch (err) { console.error("[audio-unlock] silent play failed:", err); }
        audio.src = "";
      }
      audioRef.current = audio;

      // 2. Mic with quality flags
      const stream = await ensureMic();
      stream.getAudioTracks().forEach((t) => { t.enabled = false; }); // Start muted

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
            voice: options.voice || "shimmer",
            instructions: options.instructions || "You are an energetic English teacher.",
            turn_detection: options.turnDetection || { type: "server_vad", threshold: 0.75, prefix_padding_ms: 400, silence_duration_ms: 400 },
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
        console.log("[debug] ontrack — remote audio attached");
        remoteStreamRef.current = e.streams[0];
        audio.srcObject = e.streams[0];
        audio.play().catch((err) => console.error("[ontrack] audio.play() rejected:", err));
      };

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Data channel — all conversation logic lives here
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => {
        console.log("[debug] DC_OPEN");
        callbacksRef.current.onReady?.((text: string) => sendUserText(text, true));
      };

      dc.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          const type = ev.type as string;

          // ── STUDENT STARTS SPEAKING (barge-in with 300ms delay + 800ms cooldown) ──
          if (type === "input_audio_buffer.speech_started") {
            console.log("[debug] speech_started");

            if (convStateRef.current === "AI_SPEAKING") {
              const now = Date.now();
              // 800ms cooldown — ignore rapid repeated triggers
              if (now - lastBargeInRef.current < 800) {
                console.log("[debug] barge-in ignored (cooldown)");
              } else {
                // Wait 300ms — if speech_stopped arrives, it was noise
                bargeInTimerRef.current = setTimeout(() => {
                  console.log("[debug] barge-in confirmed after 300ms");
                  lastBargeInRef.current = Date.now();
                  // Silence speaker without stopping playback (muted breaks mobile resume)
                  if (audioRef.current) audioRef.current.volume = 0;
                  // Cancel server response
                  const d = dcRef.current;
                  if (d && d.readyState === "open") {
                    d.send(JSON.stringify({ type: "response.cancel" }));
                    console.log("[debug] response.cancel sent");
                  }
                  setConvState("STUDENT_SPEAKING");
                  setMicTrackEnabled(true);
                }, 300);
              }
            } else {
              // Not during AI speech — switch immediately
              setConvState("STUDENT_SPEAKING");
              setMicTrackEnabled(true);
            }
          }

          // ── STUDENT STOPS SPEAKING ──
          if (type === "input_audio_buffer.speech_stopped") {
            console.log("[debug] speech_stopped");
            // Cancel pending barge-in timer (was just noise)
            if (bargeInTimerRef.current) {
              clearTimeout(bargeInTimerRef.current);
              bargeInTimerRef.current = null;
              console.log("[debug] barge-in cancelled (noise)");
            }
            setConvState("AI_SPEAKING");
            setMicTrackEnabled(false);
          }

          // ── STREAMING SUBTITLE DELTA ──
          if (type === "response.audio_transcript.delta" && ev.delta) {
            callbacksRef.current.onAiTextDelta?.(ev.delta);
            // Layer ① — defensive unmute on transcript delta too
            healAudio();
            // Layer ③ — count transcript deltas while audio is silent
            if (audioRef.current?.paused || audioRef.current?.volume === 0) {
              silentDeltaCountRef.current++;
              if (silentDeltaCountRef.current >= 5 && !audioHealAttemptedRef.current) {
                console.warn("[heal] 5 silent transcript deltas — attempting full audio reset");
                audioHealAttemptedRef.current = true;
                healAudio();
              }
            } else {
              silentDeltaCountRef.current = 0;
            }
          }

          // ── FULL TRANSCRIPT DONE ──
          if (type === "response.audio_transcript.done" && ev.transcript) {
            console.log("[debug] transcript.done");
            callbacksRef.current.onAiTranscriptDone?.(ev.transcript.trim());
          }

          // ── AUDIO DELTA — unmute speaker for new AI audio ──
          if (type === "response.audio.delta") {
            healAudio();
            silentDeltaCountRef.current = 0;
            if (convStateRef.current !== "AI_SPEAKING") setConvState("AI_SPEAKING");
          }

          // ── RESPONSE DONE — enable mic, let SpeakingPractice manage UI timing ──
          if (type === "response.done") {
            console.log("[debug] response.done");
            audioHealAttemptedRef.current = false;
            silentDeltaCountRef.current = 0;
            // Enable mic so VAD can detect student speech
            setMicTrackEnabled(true);
            // Transition to IDLE — UI-level "teacher speaking" indicator
            // is managed separately by SpeakingPractice via aiStreamActive
            setConvState("IDLE");
          }

          // ── USER TRANSCRIPT ──
          if (type === "conversation.item.input_audio_transcription.completed" && ev.transcript) {
            console.log("[debug] transcript.completed:", ev.transcript.trim());
            callbacksRef.current.onUserTranscript?.(ev.transcript.trim());
          }
        } catch (parseErr) { /* ignore malformed events */ }
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
      setConvState("AI_SPEAKING"); // AI speaks first

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
  }, [ensureMic, sendUserText, setConvState, setMicTrackEnabled]);

  // ── Disconnect ──

  const disconnect = useCallback(() => {
    if (bargeInTimerRef.current) { clearTimeout(bargeInTimerRef.current); bargeInTimerRef.current = null; }
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
  }, []);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    status,
    error,
    conversationState,
    isAiSpeaking: conversationState === "AI_SPEAKING",
    connect,
    disconnect,
    ensureMic,
    setMicEnabled,
    setSpeakerMuted,
    sendUserText,
    sendSessionUpdate,
  };
}
