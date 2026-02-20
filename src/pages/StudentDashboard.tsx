import { useEffect, useState } from "react";
import { formatVerbKey } from "@/lib/formatVerbKey";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { LogOut, Clock, BookOpen, CheckCircle, Play, Mic, FileText } from "lucide-react";
import TranscriptReport from "@/components/TranscriptReport";

type Assignment = {
  id: string;
  status: string;
  verb_id: string;
  task_no: number;
  is_enabled: boolean;
  completed_count: number;
  last_completed_score: number | null;
  verbs: { verb_key: string; base_verb: string; meaning_en: string | null; display_no: number | null } | null;
};

export default function StudentDashboard() {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dailyUsedSeconds, setDailyUsedSeconds] = useState(0);
  const [dailyLimitSeconds, setDailyLimitSeconds] = useState(3600);
  const [loading, setLoading] = useState(true);
  const [goToTask, setGoToTask] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [reportAssignmentId, setReportAssignmentId] = useState<string | null>(null);
  const [reportTaskLabel, setReportTaskLabel] = useState("");

  const remainingSeconds = Math.max(0, dailyLimitSeconds - dailyUsedSeconds);
  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const usagePercent = Math.min(100, (dailyUsedSeconds / dailyLimitSeconds) * 100);
  const isBlocked = remainingSeconds <= 0;

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    setLoading(true);

    const [assignRes, usageRes] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, status, verb_id, task_no, is_enabled, completed_count, last_completed_score, verbs!inner(verb_key, base_verb, meaning_en, display_no, is_active)")
        .eq("student_id", user.id)
        .eq("is_enabled", true)
        .eq("verbs.is_active", true)
        .order("task_no", { ascending: true }),
      supabase
        .from("daily_usage")
        .select("used_seconds, limit_seconds")
        .eq("student_id", user.id)
        .eq("date", new Date().toISOString().split("T")[0])
        .maybeSingle(),
    ]);

    if (assignRes.data) {
      const sorted = (assignRes.data as any[]).sort((a: Assignment, b: Assignment) => {
        const aNo = a.verbs?.display_no ?? a.task_no;
        const bNo = b.verbs?.display_no ?? b.task_no;
        return aNo - bNo;
      });
      setAssignments(sorted);
    }
    
    if (usageRes.data) {
      setDailyUsedSeconds(usageRes.data.used_seconds);
      setDailyLimitSeconds(usageRes.data.limit_seconds);
    } else {
      setDailyUsedSeconds(0);
      setDailyLimitSeconds((profile?.daily_quota_minutes || 60) * 60);
    }
    setLoading(false);
  };

  const statusConfig = {
    not_started: { label: "Not Started", variant: "outline" as const, icon: BookOpen },
    in_progress: { label: "In Progress", variant: "default" as const, icon: Play },
    completed: { label: "Completed", variant: "secondary" as const, icon: CheckCircle },
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl font-bold animate-pulse">Loading... ⏳</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black">👋 Hi, {profile?.display_name || "Student"}!</h1>
          <p className="text-muted-foreground font-semibold">Let's practice English!</p>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} className="rounded-xl">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>

      {/* Daily quota card */}
      <Card className={`mb-6 rounded-2xl kid-shadow ${isBlocked ? "border-destructive border-2" : ""}`}>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 mb-3">
            <Clock className="h-6 w-6 text-primary" />
            <span className="text-lg font-bold">Today's Speaking Time</span>
          </div>
          <Progress value={usagePercent} className="h-4 rounded-full mb-2" />
          <div className="flex justify-between text-sm font-semibold">
            <span>{Math.floor(dailyUsedSeconds / 60)}m {dailyUsedSeconds % 60}s used</span>
            <span className={isBlocked ? "text-destructive" : "text-primary"}>
              {isBlocked ? "⛔ Daily limit reached. Try again tomorrow!" : `${remainingMinutes}m ${remainingSeconds % 60}s left`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Voice Chat button */}
      <Button
        onClick={() => navigate("/voice-chat")}
        className="w-full mb-6 h-16 text-lg font-bold rounded-2xl kid-shadow gap-2 bg-secondary hover:bg-secondary/90"
      >
        <Mic className="h-6 w-6" /> Free Voice Chat 🎙️
      </Button>

      <div className="mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-black">📚 My Tasks</h2>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              placeholder="Go to #"
              value={goToTask}
              onChange={(e) => setGoToTask(e.target.value)}
              className="w-20 h-10 rounded-xl text-base text-center"
            />
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl h-10"
              onClick={() => {
                const el = document.getElementById(`task-${goToTask}`);
                if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
              }}
            >Go</Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-muted-foreground shrink-0">Range:</span>
          <Input type="number" placeholder="From #" value={filterFrom}
            onChange={(e) => setFilterFrom(e.target.value)} className="h-9 rounded-xl text-sm flex-1" />
          <span className="text-muted-foreground">–</span>
          <Input type="number" placeholder="To #" value={filterTo}
            onChange={(e) => setFilterTo(e.target.value)} className="h-9 rounded-xl text-sm flex-1" />
          {(filterFrom || filterTo) && (
            <Button size="sm" variant="ghost" className="rounded-xl text-xs h-9 px-2" onClick={() => { setFilterFrom(""); setFilterTo(""); }}>Clear</Button>
          )}
        </div>
      </div>

      {assignments.length === 0 ? (
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-muted-foreground font-semibold">No tasks yet!</p>
            <p className="text-muted-foreground">Your teacher will add verbs soon 🙂</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {(() => {
            const from = parseInt(filterFrom);
            const to = parseInt(filterTo);
            const filtered = assignments.filter(a => {
              const displayNum = a.verbs?.display_no ?? a.task_no;
              if (!isNaN(from) && displayNum < from) return false;
              if (!isNaN(to) && displayNum > to) return false;
              return true;
            });
            return filtered.length === 0 ? (
              <Card className="rounded-2xl kid-shadow">
                <CardContent className="pt-6 text-center">
                  <p className="text-muted-foreground font-semibold">No tasks in this range</p>
                </CardContent>
              </Card>
            ) : filtered.map((a) => {
            const config = statusConfig[a.status as keyof typeof statusConfig] || statusConfig.not_started;
            const StatusIcon = config.icon;
            return (
              <Card key={a.id} id={`task-${a.verbs?.display_no ?? a.task_no}`} className="rounded-2xl kid-shadow hover:scale-[1.01] transition-transform">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="text-lg font-black text-primary">#{a.verbs?.display_no ?? a.task_no}</div>
                      <div>
                        <h3 className="text-xl font-bold">{a.verbs?.verb_key ? formatVerbKey(a.verbs.verb_key, a.verbs.meaning_en) : (a.verbs?.base_verb || "Unknown")}</h3>
                         {a.completed_count > 0 && (
                          <p className="text-xs font-semibold text-secondary">
                            Completed x{a.completed_count}
                            {a.last_completed_score != null ? ` · Last score: ${a.last_completed_score}` : ""}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {a.status === "completed" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 px-2 rounded-xl text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReportAssignmentId(a.id);
                            setReportTaskLabel(`#${a.verbs?.display_no ?? a.task_no} ${a.verbs?.verb_key ? formatVerbKey(a.verbs.verb_key, a.verbs.meaning_en) : ""}`);
                          }}
                        >
                          <FileText className="h-3.5 w-3.5 mr-1" /> 📋
                        </Button>
                      )}
                      <Badge variant={config.variant} className="text-sm px-3 py-1 rounded-full">
                        <StatusIcon className="h-3.5 w-3.5 mr-1" />
                        {config.label}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    onClick={() => navigate(`/practice/${a.id}`)}
                    disabled={isBlocked}
                    className="w-full mt-3 h-14 text-lg font-bold rounded-xl kid-shadow"
                  >
                    {isBlocked ? "⛔ Daily Limit Reached" : a.completed_count > 0 ? "Practice Again 🔄" : a.status === "in_progress" ? "Continue ▶️" : "Start Practice 🎤"}
                  </Button>
                </CardContent>
              </Card>
            );
          });
          })()}
        </div>
      )}

      {/* Transcript Report Dialog */}
      <TranscriptReport
        open={!!reportAssignmentId}
        onOpenChange={(open) => { if (!open) setReportAssignmentId(null); }}
        assignmentId={reportAssignmentId || ""}
        studentName={profile?.display_name || ""}
        taskLabel={reportTaskLabel}
      />
    </div>
  );
}
