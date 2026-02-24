import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import * as XLSX from "xlsx";

type ConversationEntry = {
  role: string;
  text: string;
  ts: number;
};

type Session = {
  id: string;
  created_at: string;
  duration_seconds: number;
  student_transcripts: string[] | null;
  ai_transcripts: string[] | null;
  conversation_log: ConversationEntry[] | null;
};

// ── Text processing helpers ──

/** Strip non-Latin characters, keeping only English letters, digits, punctuation, spaces */
function stripNonEnglish(text: string): string {
  return text.replace(/[ㄱ-ㅎㅏ-ㅣ가-힣\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F]+/g, "").replace(/\s+/g, " ").trim();
}

/** Returns true if text has meaningful English content */
function hasMeaningfulEnglish(text: string): boolean {
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  return latinChars >= 2 && latinChars / Math.max(text.length, 1) > 0.3;
}

/** Normalize text for dedup comparison */
function normalizeForCompare(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// ── Report entry types ──

type ReportEntry =
  | { type: "target"; english: string; korean: string | null }
  | { type: "student"; text: string }
  | { type: "separator"; text: string };

/** Extract [TARGET] sentences and Korean meanings from teacher turns,
 *  and meaningful English from student turns */
function processConversationLog(log: ConversationEntry[]): ReportEntry[] {
  const result: ReportEntry[] = [];
  const seenTargets = new Set<string>();

  for (let i = 0; i < log.length; i++) {
    const entry = log[i];

    if (entry.role === "system" && entry.text.includes("Session Resumed")) {
      result.push({ type: "separator", text: "--- Session Resumed ---" });
      continue;
    }

    if (entry.role === "teacher") {
      // Extract all [TARGET] sentences from this teacher turn
      const targetMatches = entry.text.match(/\[TARGET\]\s*([^[]*?)(?=\[TARGET\]|$)/g);
      if (targetMatches) {
        for (const match of targetMatches) {
          const english = match.replace(/\[TARGET\]\s*/, "").trim();
          if (!english) continue;
          const norm = normalizeForCompare(english);
          if (seenTargets.has(norm)) continue;
          seenTargets.add(norm);

          // Look for Korean meaning nearby: '이건 ... 이라는 뜻이야' pattern
          const koreanMatch = entry.text.match(/이건\s+(.+?)\s*(이라는\s*뜻이야|라는\s*뜻이야)/);
          const korean = koreanMatch ? koreanMatch[1].trim() : null;

          result.push({ type: "target", english, korean });
        }
      }
      continue;
    }

    if (entry.role === "student") {
      const cleaned = stripNonEnglish(entry.text);
      if (!hasMeaningfulEnglish(cleaned)) continue;
      result.push({ type: "student", text: cleaned });
    }
  }
  return result;
}

/** Fallback for old sessions without conversation_log */
function buildFallbackEntries(
  studentTranscripts: string[] | null,
  aiTranscripts: string[] | null
): ReportEntry[] {
  const result: ReportEntry[] = [];
  const seenTargets = new Set<string>();

  // Extract [TARGET] from AI transcripts
  for (const text of (aiTranscripts || [])) {
    const targetMatches = text.match(/\[TARGET\]\s*([^[]*?)(?=\[TARGET\]|$)/g);
    if (targetMatches) {
      for (const match of targetMatches) {
        const english = match.replace(/\[TARGET\]\s*/, "").trim();
        if (!english) continue;
        const norm = normalizeForCompare(english);
        if (seenTargets.has(norm)) continue;
        seenTargets.add(norm);
        const koreanMatch = text.match(/이건\s+(.+?)\s*(이라는\s*뜻이야|라는\s*뜻이야)/);
        result.push({ type: "target", english, korean: koreanMatch ? koreanMatch[1].trim() : null });
      }
    }
  }

  // Student English only
  for (const text of (studentTranscripts || [])) {
    const cleaned = stripNonEnglish(text);
    if (hasMeaningfulEnglish(cleaned)) {
      result.push({ type: "student", text: cleaned });
    }
  }
  return result;
}

// ── Component ──

type TranscriptReportProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assignmentId: string;
  studentName?: string;
  taskLabel?: string;
  showDownload?: boolean;
};

export default function TranscriptReport({
  open,
  onOpenChange,
  assignmentId,
  studentName,
  taskLabel,
  showDownload = false,
}: TranscriptReportProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !assignmentId) return;
    loadSessions();
  }, [open, assignmentId]);

  const loadSessions = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("speaking_sessions")
      .select("id, created_at, duration_seconds, student_transcripts, ai_transcripts, conversation_log")
      .eq("assignment_id", assignmentId)
      .order("created_at", { ascending: false });
    setSessions((data as unknown as Session[]) || []);
    setLoading(false);
  };

  const downloadExcel = () => {
    const rows: { Student: string; Task: string; Date: string; Duration: string; Type: string; English: string; Korean: string }[] = [];
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleString();
      const duration = `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`;
      const entries = s.conversation_log?.length
        ? processConversationLog(s.conversation_log)
        : buildFallbackEntries(s.student_transcripts, s.ai_transcripts);

      if (entries.length === 0) {
        rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Type: "", English: "(no transcript)", Korean: "" });
      }
      for (const e of entries) {
        if (e.type === "target") {
          rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Type: "Target Sentence", English: e.english, Korean: e.korean || "" });
        } else if (e.type === "student") {
          rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Type: "Student", English: e.text, Korean: "" });
        }
      }
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transcripts");
    XLSX.writeFile(wb, `transcripts_${(studentName || "student").replace(/\s/g, "_")}_${(taskLabel || "task").replace(/\s/g, "_")}.xlsx`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Transcript Report
          </DialogTitle>
          {(studentName || taskLabel) && (
            <div className="flex gap-2 flex-wrap mt-1">
              {studentName && <Badge variant="outline" className="rounded-full">{studentName}</Badge>}
              {taskLabel && <Badge variant="secondary" className="rounded-full">{taskLabel}</Badge>}
            </div>
          )}
        </DialogHeader>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground animate-pulse">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">No session records found.</div>
        ) : (
          <div className="space-y-4">
            {showDownload && (
              <Button variant="outline" size="sm" className="rounded-xl w-full" onClick={downloadExcel}>
                <Download className="h-4 w-4 mr-2" /> Download Excel
              </Button>
            )}
            {sessions.map((s, idx) => {
              const date = new Date(s.created_at).toLocaleString();
              const duration = `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`;
              const entries = s.conversation_log?.length
                ? processConversationLog(s.conversation_log)
                : buildFallbackEntries(s.student_transcripts, s.ai_transcripts);

              // Separate targets and student lines
              const targets = entries.filter((e): e is Extract<ReportEntry, { type: "target" }> => e.type === "target");
              const studentLines = entries.filter((e): e is Extract<ReportEntry, { type: "student" }> => e.type === "student");

              return (
                <div key={s.id} className="rounded-xl border p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Session {sessions.length - idx}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{date}</span>
                      <Badge variant="outline" className="rounded-full text-[10px]">{duration}</Badge>
                    </div>
                  </div>

                  {targets.length === 0 && studentLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No transcripts recorded</p>
                  ) : (
                    <>
                      {/* Target Sentences */}
                      {targets.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">📚 Target Sentences</div>
                          {targets.map((t, i) => (
                            <div key={i} className="bg-primary/10 rounded-lg px-3 py-1.5">
                              <div className="text-sm font-semibold text-primary">{t.english}</div>
                              {t.korean && <div className="text-xs text-muted-foreground mt-0.5">{t.korean}</div>}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Student Speech */}
                      {studentLines.length > 0 && (
                        <div className="space-y-1">
                          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🗣️ Student Speech</div>
                          {studentLines.map((s, i) => (
                            <div key={i} className="text-sm bg-muted/50 rounded-lg px-3 py-1.5">
                              {s.text}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
