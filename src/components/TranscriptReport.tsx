import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText } from "lucide-react";
import * as XLSX from "xlsx";

type Session = {
  id: string;
  created_at: string;
  duration_seconds: number;
  student_transcripts: string[] | null;
  ai_transcripts: string[] | null;
};

// Returns true if the text is primarily English (Latin alphabet)
function isEnglish(text: string): boolean {
  const cleaned = text.replace(/[^a-zA-Z\u00C0-\u024F\u1E00-\u1EFF\s]/g, "");
  return cleaned.length >= text.replace(/\s/g, "").length * 0.5;
}

/** Extract quoted target sentences from AI text */
function extractTargetSentences(text: string): string[] {
  const matches = text.match(/"([^"]+)"/g);
  return matches ? matches.map(m => m.replace(/"/g, "")) : [];
}

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
      .select("id, created_at, duration_seconds, student_transcripts, ai_transcripts")
      .eq("assignment_id", assignmentId)
      .order("created_at", { ascending: false });
    setSessions((data as Session[]) || []);
    setLoading(false);
  };

  const downloadExcel = () => {
    const rows: { Student: string; Task: string; Date: string; Duration: string; Role: string; Transcript: string }[] = [];
    for (const s of sessions) {
      const date = new Date(s.created_at).toLocaleString();
      const duration = `${Math.floor(s.duration_seconds / 60)}m ${s.duration_seconds % 60}s`;
      const studentLines = (s.student_transcripts || []).filter(isEnglish);
      const aiLines = s.ai_transcripts || [];
      if (studentLines.length === 0 && aiLines.length === 0) {
        rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Role: "", Transcript: "(no transcript)" });
      }
      for (const t of studentLines) {
        rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Role: "Student", Transcript: t });
      }
      for (const t of aiLines) {
        rows.push({ Student: studentName || "", Task: taskLabel || "", Date: date, Duration: duration, Role: "Teacher", Transcript: t });
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
              const studentLines = (s.student_transcripts || []).filter(isEnglish);
              const aiLines = s.ai_transcripts || [];
              return (
                <div key={s.id} className="rounded-xl border p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold">Session {sessions.length - idx}</span>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{date}</span>
                      <Badge variant="outline" className="rounded-full text-[10px]">{duration}</Badge>
                    </div>
                  </div>
                  {studentLines.length === 0 && aiLines.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">No transcripts recorded</p>
                  ) : (
                    <div className="space-y-1">
                      {/* Teacher target sentences */}
                      {aiLines.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {aiLines.map((t, i) => {
                            const targets = extractTargetSentences(t);
                            if (targets.length === 0) return null;
                            return targets.map((target, j) => (
                              <div key={`ai-${i}-${j}`} className="text-sm bg-primary/10 rounded-lg px-3 py-1.5">
                                <span className="text-primary font-bold mr-1">🤖 (teacher)</span>
                                <span className="text-primary font-semibold">{target}</span>
                              </div>
                            ));
                          })}
                        </div>
                      )}
                      {/* Student transcripts */}
                      {studentLines.map((t, i) => (
                        <div key={i} className="text-sm bg-muted/50 rounded-lg px-3 py-1.5">
                          <span className="font-semibold mr-1">🗣️</span>
                          {t}
                        </div>
                      ))}
                    </div>
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
