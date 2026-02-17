import { useState, useRef, useCallback, useEffect } from "react";

export type RealtimeStatus = "idle" | "connecting" | "connected" | "error";

export type ConversationState = "IDLE" | "AI_SPEAKING" | "STUDENT_LISTENING";

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
  onAiTranscript?: (text: string) => void;
  onUserTranscript?: (text: string) => void;
  onReady?: (sendText: (text: string) => void) => void;
  onStateChange?: (state: ConversationState) => void;
};

/**
 * Single source of truth for OpenAI Realtime WebRTC.
 * State machine: IDLE → AI_SPEAKING ↔ STUDENT_LISTENING
 *
 * Key design:
 *  - response.done does NOT switch to STUDENT_LISTENING.
 *  - Instead an "audio tail checker" waits for audio deltas to stop (500ms gap)
 *    before transitioning, preventing premature state changes.
 *  - A 5s fail-safe ensures no deadlock if deltas never arrive.
 *  - An upper-bound (2s after response.done) ensures the tail checker can't block forever.
 */
export function useRealtimeWebRTC() {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [conversationState, setConversationState] = useState<ConversationState>("IDLE");
  const [speechDetected, setSpeechDetected] = useState(false);

  // ── Refs for state machine ──
  const responseInFlightRef = useRef(false);
  const audioActiveRef = useRef(false);
  const responseDoneRef = useRef(false);
  const lastAudioDeltaAtRef = useRef(0);
  const failSafeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tailCheckerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tailUpperBoundRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const callbacksRef = useRef<ConnectOptions>({});
  const convStateRef = useRef<ConversationState>("IDLE");
  const pendingTranscriptsRef = useRef<string[]>([]);

  // ── Helpers ──

  const setConvState = useCallback((state: ConversationState) => {
    convStateRef.current = state;
    setConversationState(state);
    callbacksRef.current.onStateChange?.(state);
    console.log(`[state] → ${state} t=${Date.now()}`);
  }, []);

  const clearAllTimers = useCallback(() => {
    if (failSafeTimerRef.current) { clearTimeout(failSafeTimerRef.current); failSafeTimerRef.current = null; }
    if (tailCheckerRef.current) { clearInterval(tailCheckerRef.current); tailCheckerRef.current = null; }
    if (tailUpperBoundRef.current) { clearTimeout(tailUpperBoundRef.current); tailUpperBoundRef.current = null; }
  }, []);

  /** Transition from AI_SPEAKING → STUDENT_LISTENING. Single exit point. */
  const finishAiTurn = useCallback(() => {
    clearAllTimers();
    responseInFlightRef.current = false;
    audioActiveRef.current = false;
    responseDoneRef.current = false;
    lastAudioDeltaAtRef.current = 0;
    setConvState("STUDENT_LISTENING");
    // Open mic
    const trk = streamRef.current?.getAudioTracks()[0];
    if (trk) trk.enabled = true;
    setSpeechDetected(false);
    console.log(`[debug] AUDIO_TAIL_LISTENING t=${Date.now()}`);

    // Flush buffered transcripts after audio finishes
    const pending = pendingTranscriptsRef.current;
    if (pending.length > 0) {
      pendingTranscriptsRef.current = [];
      pending.forEach((t) => callbacksRef.current.onAiTranscript?.(t));
    }
  }, [clearAllTimers, setConvState]);

  /** Start the tail checker interval — runs every 100ms */
  const startTailChecker = useCallback(() => {
    // Clear any existing
    if (tailCheckerRef.current) clearInterval(tailCheckerRef.current);
    tailCheckerRef.current = setInterval(() => {
      if (
        responseDoneRef.current &&
        audioActiveRef.current &&
        performance.now() - lastAudioDeltaAtRef.current >= 500
      ) {
        finishAiTurn();
      }
    }, 100);

    // Upper bound: 2s after response.done, force release
    if (tailUpperBoundRef.current) clearTimeout(tailUpperBoundRef.current);
    tailUpperBoundRef.current = setTimeout(() => {
      if (convStateRef.current === "AI_SPEAKING") {
        console.warn(`[debug] FAILSAFE_RELEASE (tail upper bound 2s) t=${Date.now()}`);
        finishAiTurn();
      }
    }, 2000);
  }, [finishAiTurn]);

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

  // ── Send text (guarded) ──

  const sendUserText = useCallback((text: string, force = false) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") {
      console.log("[sendUserText] BLOCKED — dc not open");
      return;
    }
    if (!force) {
      if (responseInFlightRef.current) { console.log("[guard] blocked — responseInFlight"); return; }
      if (convStateRef.current === "AI_SPEAKING") { console.log("[guard] blocked — AI_SPEAKING"); return; }
    }

    // Mute mic
    const trk = streamRef.current?.getAudioTracks()[0];
    if (trk) trk.enabled = false;

    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    }));

    console.log(`[debug] SENT_RESPONSE_CREATE t=${Date.now()}`);
    dc.send(JSON.stringify({ type: "response.create", response: { modalities: ["audio", "text"] } }));

    responseInFlightRef.current = true;
    audioActiveRef.current = false;
    responseDoneRef.current = false;
    lastAudioDeltaAtRef.current = 0;
    setConvState("AI_SPEAKING");
    setSpeechDetected(false);

    // Fail-safe: if no audio.delta within 5s, release
    clearAllTimers();
    failSafeTimerRef.current = setTimeout(() => {
      if (responseInFlightRef.current && !audioActiveRef.current) {
        console.warn(`[debug] FAILSAFE_RELEASE (no delta 5s) t=${Date.now()}`);
        finishAiTurn();
      }
    }, 5000);
  }, [setConvState, clearAllTimers, finishAiTurn]);

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

      // Warm up audio element in user gesture
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
      const remoteStreamRef = { current: null as MediaStream | null };

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
      let deltaLogThrottle = 0;

      dc.onopen = () => {
        console.log(`[debug] DC_OPEN t=${Date.now()}`);
        callbacksRef.current.onReady?.((text: string) => sendUserText(text, true));
      };

      dc.onmessage = (e) => {
        try {
          const ev = JSON.parse(e.data);
          const type = ev.type as string;

          // ── Barge-in ──
          if (type === "input_audio_buffer.speech_started") {
            setSpeechDetected(true);
            if (convStateRef.current === "AI_SPEAKING") {
              // Stop audio playback
              if (audioRef.current?.srcObject) {
                audioRef.current.pause();
                audioRef.current.srcObject = null;
              }
              // Cancel server-side
              const d = dcRef.current;
              if (d && d.readyState === "open") {
                d.send(JSON.stringify({ type: "response.cancel" }));
              }
              clearAllTimers();
              responseInFlightRef.current = false;
              audioActiveRef.current = false;
              responseDoneRef.current = false;
            }
            setConvState("STUDENT_LISTENING");
            const mic = streamRef.current?.getAudioTracks()[0];
            if (mic) mic.enabled = true;
          }

          // ── Student speech ended ──
          // Server VAD has create_response:true, so it auto-creates a response.
          // We do NOT send response.create here to avoid double responses.
          // Just update state to AI_SPEAKING and mute mic.
          if (type === "input_audio_buffer.speech_stopped") {
            console.log(`[debug] SPEECH_STOPPED t=${Date.now()}`);
            if (!responseInFlightRef.current) {
              responseInFlightRef.current = true;
              audioActiveRef.current = false;
              responseDoneRef.current = false;
              setConvState("AI_SPEAKING");
              const mic = streamRef.current?.getAudioTracks()[0];
              if (mic) mic.enabled = false;
              // Fail-safe in case server VAD doesn't produce a response
              clearAllTimers();
              failSafeTimerRef.current = setTimeout(() => {
                if (responseInFlightRef.current && !audioActiveRef.current) {
                  console.warn(`[debug] FAILSAFE_RELEASE (speech_stopped no response) t=${Date.now()}`);
                  finishAiTurn();
                }
              }, 5000);
            }
          }

          // ── AI audio chunk ──
          if (type === "response.audio.delta") {
            const now = performance.now();
            lastAudioDeltaAtRef.current = now;
            if (!audioActiveRef.current) {
              audioActiveRef.current = true;
              console.log(`[debug] GOT_AUDIO_DELTA (first) t=${Date.now()}`);
              // Cancel the "no delta" fail-safe since we got audio
              if (failSafeTimerRef.current) { clearTimeout(failSafeTimerRef.current); failSafeTimerRef.current = null; }
            } else {
              deltaLogThrottle++;
              if (deltaLogThrottle % 50 === 0) {
                console.log(`[debug] GOT_AUDIO_DELTA #${deltaLogThrottle} t=${Date.now()}`);
              }
            }

            // Re-attach audio if cleared by barge-in
            if (audioRef.current && !audioRef.current.srcObject && remoteStreamRef.current) {
              audioRef.current.srcObject = remoteStreamRef.current;
              audioRef.current.play().catch(() => {
                setTimeout(() => {
                  if (audioRef.current && remoteStreamRef.current) {
                    audioRef.current.srcObject = remoteStreamRef.current;
                    audioRef.current.play().catch(() => {});
                  }
                }, 100);
              });
            }

            // Ensure state
            if (convStateRef.current !== "AI_SPEAKING") setConvState("AI_SPEAKING");
            setSpeechDetected(false);
            const mic = streamRef.current?.getAudioTracks()[0];
            if (mic) mic.enabled = false;
          }

          // ── AI transcript — buffer until audio finishes ──
          if (type === "response.audio_transcript.done" && ev.transcript) {
            console.log(`[debug] GOT_AI_TRANSCRIPT (buffered) t=${Date.now()}`);
            pendingTranscriptsRef.current.push(ev.transcript.trim());
          }

          // ── response.done: transition to STUDENT_LISTENING ──
          // In WebRTC mode, audio plays via RTC track (not data channel deltas).
          // response.audio.delta may or may not arrive. So we use response.done
          // as the primary signal, with a short delay for audio buffer drain.
          if (type === "response.done") {
            console.log(`[debug] GOT_RESPONSE_DONE audioActive=${audioActiveRef.current} t=${Date.now()}`);
            responseDoneRef.current = true;
            deltaLogThrottle = 0;

            if (audioActiveRef.current) {
              // Audio deltas were received — use tail checker for precise timing
              startTailChecker();
            } else {
              // No audio deltas (WebRTC mode) — wait 800ms for RTC audio buffer to drain
              clearAllTimers();
              tailUpperBoundRef.current = setTimeout(() => {
                console.log(`[debug] AUDIO_TAIL_LISTENING (post-response.done drain) t=${Date.now()}`);
                finishAiTurn();
              }, 800);
            }
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
  }, [ensureMic, sendUserText, setConvState, clearAllTimers, finishAiTurn, startTailChecker]);

  // ── Disconnect ──

  const disconnect = useCallback(() => {
    clearAllTimers();
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    responseInFlightRef.current = false;
    audioActiveRef.current = false;
    responseDoneRef.current = false;
    lastAudioDeltaAtRef.current = 0;
    convStateRef.current = "IDLE";
    setStatus("idle");
    setConversationState("IDLE");
    setSpeechDetected(false);
  }, [clearAllTimers]);

  useEffect(() => () => { disconnect(); }, [disconnect]);

  return {
    status,
    error,
    conversationState,
    isAiSpeaking: conversationState === "AI_SPEAKING",
    audioActive: audioActiveRef.current,
    speechDetected,
    connect,
    disconnect,
    ensureMic,
    setMicEnabled,
    setSpeakerMuted,
    sendUserText,
  };
}
