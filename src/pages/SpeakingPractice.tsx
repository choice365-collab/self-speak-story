import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

export default function SpeakingPractice() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [verbData, setVerbData] = useState<VerbData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [step, setStep] = useState<"explain" | "situation" | "feedback" | "done">("explain");
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [sessionStart] = useState(Date.now());
  const [successCount, setSuccessCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    loadAssignment();
  }, [assignmentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadAssignment = async () => {
    if (!assignmentId) return;
    const { data } = await supabase
      .from("assignments")
      .select("*, verbs(*)")
      .eq("id", assignmentId)
      .single();

    if (data?.verbs) {
      setVerbData(data.verbs as any);
      // Update status to in_progress
      await supabase.from("assignments").update({ status: "in_progress" }).eq("id", assignmentId);
      // Start with explanation
      streamAI("explain", [], data.verbs as any);
    }
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
    } catch (e) {
      console.error(e);
      toast.error("Connection error");
    }
    setIsStreaming(false);
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
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error:", event.error);
      setIsListening(false);
      if (event.error === "not-allowed") {
        toast.error("Please allow microphone access");
      }
    };

    recognitionRef.current = recognition;
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
    setTranscript("");

    if (step === "situation") {
      setStep("feedback");
      await streamAI("feedback", newMsgs);
      setSuccessCount((c) => c + 1);

      if (successCount + 1 >= 3) {
        // Mark as complete
        setTimeout(async () => {
          setStep("done");
          const durationSeconds = Math.floor((Date.now() - sessionStart) / 1000);
          await supabase.from("assignments").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", assignmentId);
          await supabase.from("speaking_sessions").insert({
            student_id: user!.id,
            assignment_id: assignmentId,
            duration_seconds: durationSeconds,
          });
        }, 2000);
      }
    } else {
      await streamAI("feedback", newMsgs);
    }
  };

  const nextStep = async () => {
    if (step === "explain") {
      setStep("situation");
      await streamAI("situation", messages);
    } else if (step === "feedback" && successCount < 3) {
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
        {step === "done" && (
          <Badge className="ml-auto bg-success text-success-foreground rounded-full px-3">
            <CheckCircle className="h-4 w-4 mr-1" /> Complete!
          </Badge>
        )}
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

// Badge component inline since we use it here
function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-semibold ${className}`}>{children}</span>;
}
