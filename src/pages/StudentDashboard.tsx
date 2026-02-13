import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { LogOut, Clock, BookOpen, CheckCircle, Play } from "lucide-react";

type Assignment = {
  id: string;
  status: string;
  verb_id: string;
  verbs: { verb_key: string; base_verb: string; meaning_en: string | null; level: string | null } | null;
};

export default function StudentDashboard() {
  const { user, profile, logout } = useAuth();
  const navigate = useNavigate();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [dailyUsedSeconds, setDailyUsedSeconds] = useState(0);
  const [dailyLimitSeconds, setDailyLimitSeconds] = useState(600);
  const [loading, setLoading] = useState(true);

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
        .select("id, status, verb_id, verbs(verb_key, base_verb, meaning_en, level)")
        .eq("student_id", user.id)
        .order("assigned_at", { ascending: false }),
      supabase
        .from("daily_usage")
        .select("used_seconds, limit_seconds")
        .eq("student_id", user.id)
        .eq("date", new Date().toISOString().split("T")[0])
        .maybeSingle(),
    ]);

    if (assignRes.data) setAssignments(assignRes.data as any);
    
    if (usageRes.data) {
      setDailyUsedSeconds(usageRes.data.used_seconds);
      setDailyLimitSeconds(usageRes.data.limit_seconds);
    } else {
      // No record yet for today - use profile quota
      setDailyUsedSeconds(0);
      setDailyLimitSeconds((profile?.daily_quota_minutes || 10) * 60);
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

      {/* Assignments */}
      <h2 className="text-xl font-black mb-4">📚 My Tasks</h2>

      {assignments.length === 0 ? (
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-muted-foreground font-semibold">No tasks assigned yet!</p>
            <p className="text-muted-foreground">Ask your teacher to assign some verbs 🙂</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const config = statusConfig[a.status as keyof typeof statusConfig] || statusConfig.not_started;
            const StatusIcon = config.icon;
            return (
              <Card key={a.id} className="rounded-2xl kid-shadow hover:scale-[1.01] transition-transform">
                <CardContent className="pt-5 pb-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h3 className="text-xl font-bold capitalize">{a.verbs?.base_verb || "Unknown"}</h3>
                      <p className="text-sm text-muted-foreground">{a.verbs?.meaning_en}</p>
                    </div>
                    <Badge variant={config.variant} className="text-sm px-3 py-1 rounded-full">
                      <StatusIcon className="h-3.5 w-3.5 mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  {a.verbs?.level && (
                    <Badge variant="outline" className="text-xs rounded-full mr-2">
                      Level: {a.verbs.level}
                    </Badge>
                  )}
                  {a.status !== "completed" && (
                    <Button
                      onClick={() => navigate(`/practice/${a.id}`)}
                      disabled={isBlocked}
                      className="w-full mt-3 h-14 text-lg font-bold rounded-xl kid-shadow"
                    >
                      {isBlocked ? "⛔ Daily Limit Reached" : a.status === "in_progress" ? "Continue ▶️" : "Start Practice 🎤"}
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
