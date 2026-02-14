import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Users, BookOpen, Upload, Download, DollarSign, Clock, Search, CheckCircle2, XCircle } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import * as XLSX from "xlsx";

type Student = {
  id: string;
  student_id: string | null;
  display_name: string | null;
  daily_quota_minutes: number;
  difficulty_level: string;
  speech_speed: string;
};

type Verb = {
  id: string;
  verb_key: string;
  base_verb: string;
  meaning_en: string | null;
  is_active: boolean;
  verb_no: number;
};

type AssignmentView = {
  id: string;
  status: string;
  task_no: number;
  is_enabled: boolean;
  student_id: string;
  verb_id: string;
  completed_at: string | null;
  profiles: { student_id: string | null; display_name: string | null } | null;
  verbs: { base_verb: string; meaning_en: string | null } | null;
};

type DailyUsageRow = {
  student_id: string;
  used_seconds: number;
};

export default function AdminDashboard() {
  const { profile, logout, user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [creditBalance, setCreditBalance] = useState(0);
  const [todayUsage, setTodayUsage] = useState<DailyUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  // New student form
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentPin, setNewStudentPin] = useState("");
  const [newStudentQuota, setNewStudentQuota] = useState("60");
  const [newStudentDifficulty, setNewStudentDifficulty] = useState<"low" | "medium" | "high">("medium");
  const [newStudentSpeed, setNewStudentSpeed] = useState<"slow" | "medium" | "fast">("medium");
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Credit adjustment
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [creditType, setCreditType] = useState("topup");

  // Task filter
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [taskRangeFrom, setTaskRangeFrom] = useState("");
  const [taskRangeTo, setTaskRangeTo] = useState("");

  // Verb filter & selection
  const [verbSearch, setVerbSearch] = useState("");
  const [verbFilterStatus, setVerbFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [selectedVerbIds, setSelectedVerbIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const [studentsRes, verbsRes, assignmentsRes, creditRes, usageRes] = await Promise.all([
      supabase.from("profiles").select("id, student_id, display_name, daily_quota_minutes, difficulty_level, speech_speed").eq("role", "student"),
      supabase.from("verbs").select("id, verb_key, base_verb, meaning_en, is_active, verb_no").order("verb_no", { ascending: true }),
      supabase.from("assignments").select("id, status, task_no, is_enabled, student_id, verb_id, completed_at, profiles!assignments_student_id_profiles_fkey(student_id, display_name), verbs(base_verb, meaning_en)").order("task_no", { ascending: true }),
      supabase.from("credit_balance").select("balance_usd").limit(1).maybeSingle(),
      supabase.from("daily_usage").select("student_id, used_seconds").eq("date", today),
    ]);

    if (studentsRes.data) setStudents(studentsRes.data as Student[]);
    if (verbsRes.data) setVerbs(verbsRes.data as Verb[]);
    if (assignmentsRes.data) setAssignments(assignmentsRes.data as any);
    if (creditRes.data) setCreditBalance(Number(creditRes.data.balance_usd));
    if (usageRes.data) setTodayUsage(usageRes.data as DailyUsageRow[]);
    setLoading(false);
  };

  const totalUsedSecondsToday = todayUsage.reduce((sum, u) => sum + u.used_seconds, 0);

  const toggleAssignmentEnabled = async (assignmentId: string, currentEnabled: boolean) => {
    const { error } = await supabase
      .from("assignments")
      .update({ is_enabled: !currentEnabled })
      .eq("id", assignmentId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, is_enabled: !currentEnabled } : a));
  };

  // Filtered assignments for Tasks tab
  const filteredAssignments = assignments.filter(a => {
    if (selectedStudentId && a.student_id !== selectedStudentId) return false;
    const from = parseInt(taskRangeFrom);
    const to = parseInt(taskRangeTo);
    if (!isNaN(from) && a.task_no < from) return false;
    if (!isNaN(to) && a.task_no > to) return false;
    return true;
  });

  const createStudent = async () => {
    if (!newStudentId || !newStudentPin || newStudentPin.length !== 4) {
      toast.error("Student ID and 4-digit PIN are required");
      return;
    }
    setCreatingStudent(true);
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
        },
         body: JSON.stringify({
            role: "student",
            login_id: newStudentId,
            pin: newStudentPin,
            display_name: newStudentName || newStudentId,
            daily_quota_minutes: parseInt(newStudentQuota) || 10,
            difficulty_level: newStudentDifficulty,
            speech_speed: newStudentSpeed,
          }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Student created! 🎉");
      setNewStudentId(""); setNewStudentName(""); setNewStudentPin(""); setNewStudentQuota("60"); setNewStudentDifficulty("medium"); setNewStudentSpeed("medium");
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingStudent(false);
    }
  };

  // ---- Student Excel Export ----
  const downloadStudents = async () => {
    const rows = students.map(s => ({
      student_id: s.student_id || "",
      display_name: s.display_name || "",
      pin: "",
      daily_limit_min: s.daily_quota_minutes,
      difficulty: s.difficulty_level,
      speed: s.speech_speed,
      is_active: true,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "students");
    XLSX.writeFile(wb, "students.xlsx");
    toast.success("Downloaded students.xlsx 📥");
  };

  // ---- Student Excel Import ----
  const handleStudentExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);

      if (rows.length === 0) { toast.error("No rows found"); return; }

      const session = (await supabase.auth.getSession()).data.session;
      if (!session) { toast.error("Not authenticated"); return; }

      let created = 0, updated = 0;

      for (const row of rows) {
        const sid = String(row.student_id || "").trim();
        if (!sid) continue;

        const existing = students.find(s => s.student_id === sid);

        if (existing) {
          // UPDATE existing student profile
          const updates: any = {};
          if (row.display_name !== undefined) updates.display_name = row.display_name;
          if (row.daily_limit_min !== undefined) updates.daily_quota_minutes = parseInt(row.daily_limit_min) || 60;
          if (row.difficulty !== undefined && ["low", "medium", "high"].includes(row.difficulty)) updates.difficulty_level = row.difficulty;
          if (row.speed !== undefined && ["slow", "medium", "fast"].includes(row.speed)) updates.speech_speed = row.speed;
          if (Object.keys(updates).length > 0) {
            await supabase.from("profiles").update(updates).eq("id", existing.id);
          }
          updated++;
        } else {
          // INSERT new student via create-user edge function
          const pin = String(row.pin || "").padStart(4, "0");
          if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
            toast.error(`Skipped ${sid}: invalid PIN "${row.pin}"`);
            continue;
          }
          const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              role: "student",
              login_id: sid,
              pin,
              display_name: row.display_name || sid,
              daily_quota_minutes: parseInt(row.daily_limit_min) || 10,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(`Failed ${sid}: ${data.error}`);
            continue;
          }

          // Update difficulty/speed if provided (create-user defaults to medium/medium)
          if (data.user_id) {
            const extraUpdates: any = {};
            if (row.difficulty && ["low", "medium", "high"].includes(row.difficulty)) extraUpdates.difficulty_level = row.difficulty;
            if (row.speed && ["slow", "medium", "fast"].includes(row.speed)) extraUpdates.speech_speed = row.speed;
            if (Object.keys(extraUpdates).length > 0) {
              await supabase.from("profiles").update(extraUpdates).eq("id", data.user_id);
            }
          }
          created++;
        }
      }

      toast.success(`${created} created, ${updated} updated! 🎉`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    }
    e.target.value = "";
  };


  const downloadVerbLibrary = async () => {
    const { data, error } = await supabase
      .from("verbs")
      .select("verb_no, verb_key, base_verb, meaning_en, is_active, example_short_1, example_short_2, example_short_3, example_long_1, example_long_2, example_long_3, situation_1, situation_2, situation_3, situation_4, situation_5")
      .order("verb_no", { ascending: true });
    if (error || !data) {
      toast.error(error?.message || "Failed to load verbs");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "verbs");
    XLSX.writeFile(wb, "verb_library.xlsx");
    toast.success("Downloaded verb_library.xlsx 📥");
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);

      const hasIsActiveColumn = rows.length > 0 && "is_active" in rows[0];

      const verbRows = rows.map((row: any) => {
        const base: any = {
          verb_key: row.verb_key || "",
          base_verb: row.base_verb || "",
          meaning_en: row.meaning_en || null,
          example_short_1: row.example_short_1 || null,
          example_short_2: row.example_short_2 || null,
          example_short_3: row.example_short_3 || null,
          example_long_1: row.example_long_1 || null,
          example_long_2: row.example_long_2 || null,
          example_long_3: row.example_long_3 || null,
          situation_1: row.situation_1 || null,
          situation_2: row.situation_2 || null,
          situation_3: row.situation_3 || null,
          situation_4: row.situation_4 || null,
          situation_5: row.situation_5 || null,
          created_by: user?.id,
        };
        if (hasIsActiveColumn) {
          base.is_active = row.is_active === false || row.is_active === "false" || row.is_active === 0 ? false : true;
        }
        return base;
      }).filter((v: any) => v.verb_key && v.base_verb);

      if (verbRows.length === 0) {
        toast.error("No valid verbs found in file");
        return;
      }

      // Separate into updates vs inserts by checking existing verb_keys
      const { data: existingVerbs } = await supabase
        .from("verbs")
        .select("id, verb_key");
      const existingMap = new Map((existingVerbs || []).map(v => [v.verb_key, v.id]));

      const toUpdate = verbRows.filter(v => existingMap.has(v.verb_key));
      const toInsert = verbRows.filter(v => !existingMap.has(v.verb_key));

      // Update existing verbs — exclude created_by and verb_key, and exclude is_active if column absent
      for (const v of toUpdate) {
        const { created_by: _cb, verb_key: _vk, ...updateData } = v;
        await supabase.from("verbs").update(updateData).eq("verb_key", v.verb_key);
      }

      // Insert new verbs — default is_active to true if column absent
      const insertRows = toInsert.map(v => {
        const { created_by, ...rest } = v;
        return { ...rest, created_by, is_active: v.is_active ?? true };
      });

      let newVerbIds: { id: string; verb_no: number }[] = [];
      if (insertRows.length > 0) {
        const { data: insertedVerbs, error } = await supabase.from("verbs").insert(insertRows).select("id, verb_no");
        if (error) throw error;
        newVerbIds = (insertedVerbs || []) as { id: string; verb_no: number }[];
      }

      // Auto-assign NEW verbs to all students using verb_no as task_no
      if (newVerbIds.length > 0 && students.length > 0) {
        for (const s of students) {
          // Get existing verb_ids for this student to avoid duplicates
          const { data: existing } = await supabase
            .from("assignments").select("verb_id").eq("student_id", s.id);
          const existingVerbIds = new Set((existing || []).map(a => a.verb_id));

          const assignmentRows = newVerbIds
            .filter(v => !existingVerbIds.has(v.id))
            .map(v => ({
              student_id: s.id,
              verb_id: v.id,
              assigned_by: user?.id,
              task_no: v.verb_no,
            }));
          if (assignmentRows.length > 0) {
            const { error: assignError } = await supabase.from("assignments").insert(assignmentRows);
            if (assignError) console.error("Auto-assign error for student", s.id, assignError);
          }
        }
      }

      toast.success(`${toUpdate.length} updated, ${toInsert.length} new verbs added! 📚`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    }
    e.target.value = "";
  };

  const adjustCredit = async () => {
    const amount = parseFloat(creditAmount);
    if (!amount || isNaN(amount)) {
      toast.error("Enter a valid amount");
      return;
    }

    const signedAmount = creditType === "deduct" ? -Math.abs(amount) : Math.abs(amount);

    // Insert credit event
    const { error: eventError } = await supabase.from("credit_events").insert({
      type: creditType,
      amount_usd: signedAmount,
      note: creditNote || null,
    });
    if (eventError) {
      toast.error(eventError.message);
      return;
    }

    // Update credit balance
    const newBalance = creditBalance + signedAmount;
    const { error: balanceError } = await supabase
      .from("credit_balance")
      .update({ balance_usd: newBalance, updated_at: new Date().toISOString() })
      .not("id", "is", null); // update all (single row)

    if (balanceError) {
      toast.error(balanceError.message);
      return;
    }

    setCreditBalance(newBalance);
    setCreditAmount("");
    setCreditNote("");
    toast.success(`Credit ${creditType === "deduct" ? "deducted" : "added"}! 💰`);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-xl font-bold animate-pulse">Loading... ⏳</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black">🛡️ Admin Dashboard</h1>
          <p className="text-muted-foreground font-semibold">Welcome, {profile?.display_name}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} className="rounded-xl">
          <LogOut className="h-5 w-5" />
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-4 pb-3 text-center">
            <Users className="h-8 w-8 mx-auto mb-1 text-primary" />
            <div className="text-3xl font-black">{students.length}</div>
            <div className="text-sm font-semibold text-muted-foreground">Students</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-4 pb-3 text-center">
            <BookOpen className="h-8 w-8 mx-auto mb-1 text-secondary" />
            <div className="text-3xl font-black">{verbs.length}</div>
            <div className="text-sm font-semibold text-muted-foreground">Verbs</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-4 pb-3 text-center">
            <Clock className="h-8 w-8 mx-auto mb-1 text-accent" />
            <div className="text-3xl font-black">{Math.floor(totalUsedSecondsToday / 60)}m</div>
            <div className="text-sm font-semibold text-muted-foreground">Used Today</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign className="h-8 w-8 mx-auto mb-1 text-success" />
            <div className="text-3xl font-black">${creditBalance.toFixed(2)}</div>
            <div className="text-sm font-semibold text-muted-foreground">Credits</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="w-full h-14 rounded-2xl mb-4">
          <TabsTrigger value="students" className="flex-1 text-base font-bold rounded-xl">Students</TabsTrigger>
          <TabsTrigger value="tasks" className="flex-1 text-base font-bold rounded-xl">Tasks</TabsTrigger>
          <TabsTrigger value="verbs" className="flex-1 text-base font-bold rounded-xl">Verbs</TabsTrigger>
          <TabsTrigger value="credits" className="flex-1 text-base font-bold rounded-xl">Credits</TabsTrigger>
        </TabsList>

        {/* Students Tab */}
        <TabsContent value="students" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">➕ Add Student</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Input value={newStudentId} onChange={(e) => setNewStudentId(e.target.value)}
                placeholder="Student ID" className="h-12 rounded-xl text-base" />
              <Input value={newStudentName} onChange={(e) => setNewStudentName(e.target.value)}
                placeholder="Display Name (optional)" className="h-12 rounded-xl text-base" />
              <Input type="tel" value={newStudentPin}
                onChange={(e) => setNewStudentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="4-digit PIN" maxLength={4} className="h-12 rounded-xl text-base tracking-widest" />
              <div className="space-y-1.5">
                <Label className="text-sm font-semibold">Daily Speaking Limit</Label>
                <div className="relative">
                  <Input type="number" value={newStudentQuota} onChange={(e) => setNewStudentQuota(e.target.value)}
                    placeholder="10" className="h-12 rounded-xl text-base pr-20" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">min/day</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Difficulty</Label>
                  <div className="flex rounded-xl border overflow-hidden">
                    {([["L", "low"], ["M", "medium"], ["H", "high"]] as const).map(([label, value]) => (
                      <button key={value} type="button"
                        onClick={() => setNewStudentDifficulty(value)}
                        className={`flex-1 h-10 text-sm font-bold transition-colors ${newStudentDifficulty === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-sm font-semibold">Speed</Label>
                  <div className="flex rounded-xl border overflow-hidden">
                    {([["L", "slow"], ["M", "medium"], ["H", "fast"]] as const).map(([label, value]) => (
                      <button key={value} type="button"
                        onClick={() => setNewStudentSpeed(value)}
                        className={`flex-1 h-10 text-sm font-bold transition-colors ${newStudentSpeed === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              </div>
              <Button onClick={createStudent} disabled={creatingStudent} className="w-full h-12 rounded-xl font-bold text-base">
                {creatingStudent ? "Creating..." : "Create Student"}
              </Button>
            </CardContent>
          </Card>

          {/* Student Excel Import/Export */}
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">📤 Upload / Download Students</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Columns: student_id (required), display_name, pin (required for new), daily_limit_min, difficulty, speed, is_active
              </p>
              <label className="block">
                <div className="flex items-center justify-center w-full h-14 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary cursor-pointer transition-colors">
                  <Upload className="h-5 w-5 mr-2 text-primary" />
                  <span className="font-bold text-primary">Upload Students (Excel)</span>
                </div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleStudentExcelUpload} className="hidden" />
              </label>
              <Button variant="outline" onClick={downloadStudents} className="w-full h-12 rounded-xl font-bold text-base">
                <Download className="h-5 w-5 mr-2" /> Download Students (Excel)
              </Button>
            </CardContent>
          </Card>

          <h3 className="text-lg font-bold">📋 Student List</h3>
          {students.map((s) => {
            const studentAssignments = assignments.filter(a => a.student_id === s.id);
            const completed = studentAssignments.filter(a => a.status === "completed").length;
            const studentUsage = todayUsage.find(u => u.student_id === s.id);
            return (
              <Card key={s.id} className="rounded-2xl kid-shadow">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <div className="font-bold text-lg">{s.display_name}</div>
                      <div className="text-sm text-muted-foreground">ID: {s.student_id} | {s.daily_quota_minutes} min/day</div>
                      <div className="text-xs text-muted-foreground">
                        Difficulty: {s.difficulty_level} | Speed: {s.speech_speed}
                      </div>
                    </div>
                    <Badge variant="outline" className="rounded-full">
                      {completed}/{studentAssignments.length} done
                    </Badge>
                  </div>
                  {studentUsage && (
                    <div className="text-xs text-muted-foreground mt-1">
                      Today: {Math.floor(studentUsage.used_seconds / 60)}m {studentUsage.used_seconds % 60}s used
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardContent className="pt-4 pb-3">
              <p className="text-sm text-muted-foreground">
                ✅ Assignments are created automatically when students or verbs are added.
              </p>
            </CardContent>
          </Card>

          {/* Filters */}
          <Card className="rounded-2xl kid-shadow">
            <CardContent className="pt-4 pb-3 space-y-3">
              <select
                value={selectedStudentId}
                onChange={(e) => setSelectedStudentId(e.target.value)}
                className="w-full h-12 rounded-xl border bg-background px-3 text-base"
              >
                <option value="">All Students</option>
                {students.map(s => (
                  <option key={s.id} value={s.id}>{s.display_name || s.student_id}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <Input
                  type="number" placeholder="From #" value={taskRangeFrom}
                  onChange={(e) => setTaskRangeFrom(e.target.value)}
                  className="h-10 rounded-xl text-base"
                />
                <Input
                  type="number" placeholder="To #" value={taskRangeTo}
                  onChange={(e) => setTaskRangeTo(e.target.value)}
                  className="h-10 rounded-xl text-base"
                />
              </div>
            </CardContent>
          </Card>

          <h3 className="text-lg font-bold">📊 Tasks ({filteredAssignments.length})</h3>
          {filteredAssignments.map((a) => (
            <Card key={a.id} className={`rounded-2xl kid-shadow ${!a.is_enabled ? "opacity-50" : ""}`}>
              <CardContent className="pt-4 pb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="text-lg font-black text-primary shrink-0">#{a.task_no}</div>
                  <div className="min-w-0">
                    <div className="font-bold truncate">{a.profiles?.display_name || a.profiles?.student_id}</div>
                    <div className="text-sm text-muted-foreground truncate">{a.verbs?.base_verb} - {a.verbs?.meaning_en}</div>
                    {a.completed_at && (
                      <div className="text-xs text-muted-foreground">Done: {new Date(a.completed_at).toLocaleDateString()}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={a.status === "completed" ? "secondary" : a.status === "in_progress" ? "default" : "outline"}
                    className="rounded-full capitalize text-xs">{a.status.replace("_", " ")}</Badge>
                  <button
                    onClick={() => toggleAssignmentEnabled(a.id, a.is_enabled)}
                    className={`w-10 h-6 rounded-full transition-colors ${a.is_enabled ? "bg-primary" : "bg-muted"}`}
                  >
                    <div className={`w-4 h-4 bg-background rounded-full transition-transform mx-1 ${a.is_enabled ? "translate-x-4" : ""}`} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Verbs Tab */}
        <TabsContent value="verbs" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">📤 Upload Verbs (Excel)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground mb-1">
                Columns: verb_key, base_verb, meaning_en, is_active, example_short_1~3, example_long_1~3, situation_1~5
              </p>
              <p className="text-xs text-muted-foreground">
                Existing verb_key → updated. New verb_key → inserted &amp; assigned to all students.
              </p>
              <label className="block">
                <div className="flex items-center justify-center w-full h-16 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary cursor-pointer transition-colors">
                  <Upload className="h-5 w-5 mr-2 text-primary" />
                  <span className="font-bold text-primary">Choose Excel File</span>
                </div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
              </label>
              <Button variant="outline" onClick={downloadVerbLibrary} className="w-full h-12 rounded-xl font-bold text-base">
                <Download className="h-5 w-5 mr-2" /> Download Verb Library (Excel)
              </Button>
            </CardContent>
          </Card>

          {/* Filter Tabs */}
          <div className="flex gap-2">
            {(["all", "active", "inactive"] as const).map((tab) => {
              const count = tab === "all" ? verbs.length : verbs.filter(v => tab === "active" ? v.is_active : !v.is_active).length;
              return (
                <button
                  key={tab}
                  onClick={() => setVerbFilterStatus(tab)}
                  className={`flex-1 py-2.5 px-3 rounded-xl text-sm font-bold transition-colors ${
                    verbFilterStatus === tab
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {tab === "all" ? "All" : tab === "active" ? "Active" : "Inactive"} ({count})
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-3 h-5 w-5 text-muted-foreground" />
            <Input
              value={verbSearch}
              onChange={(e) => setVerbSearch(e.target.value)}
              placeholder="Search verbs..."
              className="h-11 rounded-xl text-base pl-10"
            />
          </div>

          {/* Bulk Actions */}
          {selectedVerbIds.size > 0 && (
            <Card className="rounded-2xl kid-shadow border-primary/30">
              <CardContent className="pt-3 pb-3 flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm font-bold">{selectedVerbIds.size} selected</span>
                <div className="flex gap-2">
                  <Button size="sm" className="rounded-xl text-xs" onClick={async () => {
                    const ids = Array.from(selectedVerbIds);
                    const { error } = await supabase.from("verbs").update({ is_active: true }).in("id", ids);
                    if (error) { toast.error(error.message); return; }
                    setVerbs(prev => prev.map(v => ids.includes(v.id) ? { ...v, is_active: true } : v));
                    setSelectedVerbIds(new Set());
                    toast.success("Activated ✅");
                  }}>Activate Selected</Button>
                  <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={async () => {
                    const ids = Array.from(selectedVerbIds);
                    const { error } = await supabase.from("verbs").update({ is_active: false }).in("id", ids);
                    if (error) { toast.error(error.message); return; }
                    setVerbs(prev => prev.map(v => ids.includes(v.id) ? { ...v, is_active: false } : v));
                    setSelectedVerbIds(new Set());
                    toast.success("Deactivated 🗑️");
                  }}>Deactivate Selected</Button>
                  <Button size="sm" variant="ghost" className="rounded-xl text-xs" onClick={() => setSelectedVerbIds(new Set())}>Clear</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {(() => {
            const searchLower = verbSearch.toLowerCase();
            const filtered = verbs.filter(v => {
              if (verbFilterStatus === "active" && !v.is_active) return false;
              if (verbFilterStatus === "inactive" && v.is_active) return false;
              if (searchLower && !v.base_verb.toLowerCase().includes(searchLower) && !v.verb_key.toLowerCase().includes(searchLower) && !(v.meaning_en || "").toLowerCase().includes(searchLower)) return false;
              return true;
            });

            return (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold">📚 Verb List ({filtered.length})</h3>
                  <Button size="sm" variant="ghost" className="text-xs rounded-xl" onClick={() => {
                    if (selectedVerbIds.size === filtered.length) {
                      setSelectedVerbIds(new Set());
                    } else {
                      setSelectedVerbIds(new Set(filtered.map(v => v.id)));
                    }
                  }}>
                    {selectedVerbIds.size === filtered.length && filtered.length > 0 ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <div className="space-y-2">
                  {filtered.map((v) => (
                    <Card key={v.id} className={`rounded-xl kid-shadow transition-colors ${!v.is_active ? "bg-muted/50 border-muted" : ""}`}>
                      <CardContent className="pt-3 pb-2 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={selectedVerbIds.has(v.id)}
                          onChange={() => {
                            setSelectedVerbIds(prev => {
                              const next = new Set(prev);
                              if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                              return next;
                            });
                          }}
                          className="h-5 w-5 rounded shrink-0 accent-primary"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className="rounded-full text-xs font-black px-1.5 py-0 shrink-0">#{v.verb_no}</Badge>
                            <span className={`font-bold capitalize ${!v.is_active ? "text-muted-foreground" : ""}`}>{v.base_verb}</span>
                            {v.is_active ? (
                              <Badge className="rounded-full bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] px-1.5 py-0">
                                <CheckCircle2 className="h-3 w-3 mr-0.5" /> Active
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="rounded-full text-muted-foreground border-muted-foreground/30 text-[10px] px-1.5 py-0">
                                <XCircle className="h-3 w-3 mr-0.5" /> Inactive
                              </Badge>
                            )}
                          </div>
                          <span className={`text-sm ${!v.is_active ? "text-muted-foreground/60" : "text-muted-foreground"}`}>{v.meaning_en}</span>
                        </div>
                        <Switch
                          checked={v.is_active}
                          onCheckedChange={async (checked) => {
                            const { error } = await supabase.from("verbs").update({ is_active: checked }).eq("id", v.id);
                            if (error) { toast.error(error.message); return; }
                            setVerbs(prev => prev.map(verb => verb.id === v.id ? { ...verb, is_active: checked } : verb));
                            toast.success(checked ? "Activated ✅" : "Deactivated 🗑️");
                          }}
                        />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </>
            );
          })()}
        </TabsContent>

        {/* Credits Tab */}
        <TabsContent value="credits" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">💰 Credit Balance</CardTitle></CardHeader>
            <CardContent>
              <div className="text-4xl font-black text-center mb-4">${creditBalance.toFixed(2)}</div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">➕ Adjust Credit</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <select value={creditType} onChange={(e) => setCreditType(e.target.value)}
                className="w-full h-12 rounded-xl border bg-background px-3 text-base">
                <option value="topup">Top Up</option>
                <option value="deduct">Deduct</option>
                <option value="adjust">Adjust</option>
              </select>
              <Input type="number" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)}
                placeholder="Amount (USD)" className="h-12 rounded-xl text-base" step="0.01" />
              <Input value={creditNote} onChange={(e) => setCreditNote(e.target.value)}
                placeholder="Note (optional)" className="h-12 rounded-xl text-base" />
              <Button onClick={adjustCredit} className="w-full h-12 rounded-xl font-bold text-base">
                Apply Credit Change
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
