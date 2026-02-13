import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Mic, MicOff, Volume2, CheckCircle } from "lucide-react";

type VerbData = {
  verb: string;
  meaning_en: string | null;
  example_short_1: string | null;
  example_short_2: string | null;
  example_short_3: string | null;
  example_long_1: string | null;
  example_long_2: string | null;
  example_long_3: string | null;
  situation_1: string | null;
  situation_2: string | null;
  situation_3: string | null;
  situation_4: string | null;
  situation_5: string | null;
};

type Message = { role: "user" | "assistant"; content: string };

const REQUIRED_PASSES = 3;
const TARGET_SECONDS = 300; // 5 minutes

export default function SpeakingPractice() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const [verbData, setVerbData] = useState<VerbData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [step, setStep] = useState<"explain" | "situation" | "feedback" | "done">("explain");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionStart] = useState(Date.now());
  const [successCount, setSuccessCount] = useState(0);
  const [situationIndex, setSituationIndex] = useState(1);
  const [attemptNo, setAttemptNo] = useState(1);
  const [isBlocked, setIsBlocked] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const totalAudioSecondsRef = useRef(0);
  const speechStartRef = useRef<number | null>(null);

  useEffect(() => {
    loadAssignment();
  }, [assignmentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const checkDailyLimit = async (): Promise<boolean> => {
    if (!user) return true;
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("daily_usage")
      .select("used_seconds, limit_seconds")
      .eq("student_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (data && data.used_seconds >= data.limit_seconds) {
      setIsBlocked(true);
      return true;
    }
    return false;
  };

  const loadAssignment = async () => {
    if (!assignmentId) return;
    
    const blocked = await checkDailyLimit();
    if (blocked) {
      toast.error("Daily limit reached. Try again tomorrow!");
      return;
    }

    const { data } = await supabase
      .from("assignments")
      .select("*, verbs(*)")
      .eq("id", assignmentId)
      .single();

    if (data?.verbs) {
      setVerbData(data.verbs as any);
      await supabase.from("assignments").update({ status: "in_progress" }).eq("id", assignmentId);
      streamAI("explain", [], data.verbs as any);
    }
  };

  const updateDailyUsage = async (addSeconds: number) => {
    if (!user) return;
    const today = new Date().toISOString().split("T")[0];
    const limitSeconds = (profile?.daily_quota_minutes || 10) * 60;

    // Try upsert
    const { data: existing } = await supabase
      .from("daily_usage")
      .select("id, used_seconds")
      .eq("student_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (existing) {
      const newUsed = existing.used_seconds + addSeconds;
      await supabase
        .from("daily_usage")
        .update({ used_seconds: newUsed })
        .eq("id", existing.id);
      if (newUsed >= limitSeconds) setIsBlocked(true);
    } else {
      await supabase.from("daily_usage").insert({
        student_id: user.id,
        date: today,
        used_seconds: addSeconds,
        limit_seconds: limitSeconds,
      });
    }
  };

  const writePracticeLog = async (studentTranscript: string, aiFeedback: string, result: "pass" | "fail", audioSec: number) => {
    if (!user || !assignmentId) return;
    await supabase.from("practice_logs").insert({
      student_id: user.id,
      assignment_id: assignmentId,
      situation_index: situationIndex,
      attempt_no: attemptNo,
      student_transcript: studentTranscript,
      ai_feedback: aiFeedback,
      result,
      audio_seconds: audioSec,
    });
  };

  const streamAI = async (action: string, msgs: Message[], verb?: VerbData) => {
    setIsStreaming(true);
    const vd = verb || verbData;
    if (!vd) return;

    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/speaking-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: msgs, verb_data: vd, action }),
      });

      if (!resp.ok) {
        const err = await resp.json();
        toast.error(err.error || "AI error");
        setIsStreaming(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") break;
          try {
            const parsed = JSON.parse(json);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantText += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantText } : m);
                }
                return [...prev, { role: "assistant", content: assistantText }];
              });
            }
          } catch {}
        }
      }

      return assistantText;
    } catch (e) {
      console.error(e);
      toast.error("Connection error");
    } finally {
      setIsStreaming(false);
    }
  };

  const startListening = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event: any) => {
      const result = event.results[event.results.length - 1];
      setTranscript(result[0].transcript);
    };

    recognition.onend = () => {
      setIsListening(false);
      if (speechStartRef.current) {
        const elapsed = Math.floor((Date.now() - speechStartRef.current) / 1000);
        totalAudioSecondsRef.current += elapsed;
        speechStartRef.current = null;
      }
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error:", event.error);
      setIsListening(false);
      speechStartRef.current = null;
      if (event.error === "not-allowed") {
        toast.error("Please allow microphone access");
      }
    };

    recognitionRef.current = recognition;
    speechStartRef.current = Date.now();
    recognition.start();
    setIsListening(true);
    setTranscript("");
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const sendAnswer = async () => {
    if (!transcript.trim()) return;
    const userMsg: Message = { role: "user", content: transcript };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    const currentTranscript = transcript;
    setTranscript("");

    // Calculate audio seconds for this attempt
    const audioSec = totalAudioSecondsRef.current;
    totalAudioSecondsRef.current = 0;

    setStep("feedback");
    const aiFeedback = await streamAI("feedback", newMsgs) || "";

    // Determine pass/fail based on AI feedback (simple heuristic)
    const isPass = !aiFeedback.toLowerCase().includes("try again") && 
                   !aiFeedback.toLowerCase().includes("incorrect") &&
                   aiFeedback.length > 10;
    const result = isPass ? "pass" : "fail";

    // Write practice log
    await writePracticeLog(currentTranscript, aiFeedback, result as "pass" | "fail", audioSec);

    // Update daily usage
    await updateDailyUsage(audioSec);

    if (isPass) {
      const newCount = successCount + 1;
      setSuccessCount(newCount);
      setAttemptNo(1);

      const totalSessionSeconds = Math.floor((Date.now() - sessionStart) / 1000);

      if (newCount >= REQUIRED_PASSES || totalSessionSeconds >= TARGET_SECONDS) {
        // Mark assignment complete
        setTimeout(async () => {
          setStep("done");
          await supabase.from("assignments")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", assignmentId);
          // Also record in speaking_sessions
          await supabase.from("speaking_sessions").insert({
            student_id: user!.id,
            assignment_id: assignmentId,
            duration_seconds: totalSessionSeconds,
          });
        }, 2000);
      }
    } else {
      setAttemptNo((n) => n + 1);
    }
  };

  const nextStep = async () => {
    // Check limit before continuing
    const blocked = await checkDailyLimit();
    if (blocked) {
      toast.error("Daily limit reached. Try again tomorrow!");
      return;
    }

    if (step === "explain") {
      setStep("situation");
      await streamAI("situation", messages);
    } else if (step === "feedback" && successCount < REQUIRED_PASSES) {
      setSituationIndex((i) => i + 1);
      setStep("situation");
      await streamAI("situation", messages);
    }
  };

  const speakText = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.85;
    speechSynthesis.speak(utterance);
  };

  if (isBlocked && !verbData) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="rounded-2xl kid-shadow max-w-md w-full">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="text-5xl">⛔</div>
            <h2 className="text-2xl font-black">Daily Limit Reached</h2>
            <p className="text-muted-foreground font-semibold">Try again tomorrow!</p>
            <Button onClick={() => navigate("/")} className="w-full h-14 text-lg font-bold rounded-xl">
              Go Back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!verbData) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl font-bold animate-pulse">Loading... ⏳</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={() => navigate("/")} className="rounded-xl">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-xl font-black capitalize">🗣️ {verbData.verb}</h1>
          <p className="text-sm text-muted-foreground">{verbData.meaning_en}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="rounded-full text-xs">
            {successCount}/{REQUIRED_PASSES} passes
          </Badge>
          {step === "done" && (
            <Badge className="bg-success text-success-foreground rounded-full px-3">
              <CheckCircle className="h-4 w-4 mr-1" /> Complete!
            </Badge>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <Card className={`max-w-[85%] rounded-2xl ${m.role === "user" ? "bg-primary text-primary-foreground" : "kid-shadow"}`}>
              <CardContent className="pt-3 pb-3 px-4">
                <p className="text-base whitespace-pre-wrap">{m.content}</p>
                {m.role === "assistant" && (
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => speakText(m.content)}
                    className="mt-1 p-1 h-8"
                  >
                    <Volume2 className="h-4 w-4 mr-1" /> Listen
                  </Button>
                )}
              </CardContent>
            </Card>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Controls */}
      <div className="border-t p-4 space-y-3">
        {step === "done" ? (
          <Button onClick={() => navigate("/")} className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow">
            🎉 Great Job! Go Back
          </Button>
        ) : (
          <>
            {transcript && (
              <Card className="rounded-xl bg-muted">
                <CardContent className="pt-3 pb-3 px-4 text-base">{transcript}</CardContent>
              </Card>
            )}

            <div className="flex gap-3">
              {(step === "situation" || step === "feedback") && !isStreaming && (
                <Button
                  onClick={isListening ? stopListening : startListening}
                  className={`flex-1 h-16 text-lg font-bold rounded-2xl kid-shadow ${isListening ? "bg-destructive hover:bg-destructive/90" : ""}`}
                  disabled={isStreaming}
                >
                  {isListening ? (
                    <><MicOff className="h-6 w-6 mr-2" /> Stop</>
                  ) : (
                    <><Mic className="h-6 w-6 mr-2" /> Speak 🎤</>
                  )}
                </Button>
              )}

              {transcript && !isListening && (
                <Button onClick={sendAnswer} className="flex-1 h-16 text-lg font-bold rounded-2xl kid-shadow" disabled={isStreaming}>
                  Send ✉️
                </Button>
              )}

              {!isListening && !transcript && !isStreaming && step !== "situation" && (
                <Button onClick={nextStep} className="flex-1 h-16 text-lg font-bold rounded-2xl kid-shadow">
                  {step === "explain" ? "Next: Practice! ▶️" : step === "feedback" ? "Try Again 🔁" : "Continue"}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
