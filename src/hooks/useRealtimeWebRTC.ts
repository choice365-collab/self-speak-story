import { useState, useRef, useCallback } from "react";

type ConnectionState = "idle" | "connecting" | "connected" | "error";

export type RealtimeEvent = {
  type: string;
  timestamp: number;
  data?: any;
};

export function useRealtimeWebRTC() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const addEvent = useCallback((type: string, data?: any) => {
    setEvents((prev) => [...prev.slice(-49), { type, timestamp: Date.now(), data }]);
  }, []);

  const connect = useCallback(async (model?: string, voice?: string) => {
    setState("connecting");
    setError(null);

    try {
      // 1. Get ephemeral token from our edge function
      const tokenRes = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/realtime-token`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ model, voice }),
        }
      );

      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        throw new Error(err.error || `Token request failed: ${tokenRes.status}`);
      }

      const session = await tokenRes.json();
      const ephemeralKey = session.client_secret?.value;
      if (!ephemeralKey) throw new Error("No ephemeral key returned");

      addEvent("session_created", { id: session.id });

      // 2. Create peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Remote audio playback
      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;

      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
        addEvent("audio_track_received");
      };

      // 3. Get microphone
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
      addEvent("microphone_connected");

      // 4. Data channel for events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onopen = () => addEvent("data_channel_open");
      dc.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          addEvent(event.type, event);
        } catch {
          addEvent("data_channel_message", { raw: e.data });
        }
      };

      // 5. Create SDP offer and set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // 6. Send SDP to OpenAI Realtime API with ephemeral key
      const sdpRes = await fetch(
        `https://api.openai.com/v1/realtime?model=${model || "gpt-4o-mini-realtime-preview"}`,
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
        const errText = await sdpRes.text();
        throw new Error(`SDP exchange failed: ${sdpRes.status} - ${errText}`);
      }

      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setState("connected");
      addEvent("connected");

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setState("error");
          setError("Connection lost");
          addEvent("disconnected");
        }
      };
    } catch (e: any) {
      console.error("WebRTC connect error:", e);
      setState("error");
      setError(e.message || "Failed to connect");
      addEvent("error", { message: e.message });
    }
  }, [addEvent]);

  const disconnect = useCallback(() => {
    dcRef.current?.close();
    pcRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.remove();
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    streamRef.current = null;
    setState("idle");
    addEvent("disconnected_by_user");
  }, [addEvent]);

  const toggleMute = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      setIsMuted(!track.enabled);
      addEvent(track.enabled ? "unmuted" : "muted");
    }
  }, [addEvent]);

  const sendEvent = useCallback((event: Record<string, any>) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(event));
      addEvent("sent_event", event);
    }
  }, [addEvent]);

  return {
    state,
    events,
    isMuted,
    error,
    connect,
    disconnect,
    toggleMute,
    sendEvent,
  };
}
