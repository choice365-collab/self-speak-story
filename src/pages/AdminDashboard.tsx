import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Users, BookOpen, Upload, Download, DollarSign, Clock } from "lucide-react";
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
  const [newStudentQuota, setNewStudentQuota] = useState("10");
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Credit adjustment
  const [creditAmount, setCreditAmount] = useState("");
  const [creditNote, setCreditNote] = useState("");
  const [creditType, setCreditType] = useState("topup");

  // Task filter
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [taskRangeFrom, setTaskRangeFrom] = useState("");
  const [taskRangeTo, setTaskRangeTo] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const [studentsRes, verbsRes, assignmentsRes, creditRes, usageRes] = await Promise.all([
      supabase.from("profiles").select("id, student_id, display_name, daily_quota_minutes, difficulty_level, speech_speed").eq("role", "student"),
      supabase.from("verbs").select("id, verb_key, base_verb, meaning_en").order("base_verb"),
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
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Student created! 🎉");
      setNewStudentId(""); setNewStudentName(""); setNewStudentPin(""); setNewStudentQuota("10");
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingStudent(false);
    }
  };



  const downloadVerbLibrary = async () => {
    const { data, error } = await supabase
      .from("verbs")
      .select("verb_key, base_verb, meaning_en, example_short_1, example_short_2, example_short_3, example_long_1, example_long_2, example_long_3, situation_1, situation_2, situation_3, situation_4, situation_5")
      .order("created_at", { ascending: true });
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

      const verbRows = rows.map((row: any) => ({
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
      })).filter((v: any) => v.verb_key && v.base_verb);

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

      // Update existing verbs
      for (const v of toUpdate) {
        const { created_by, ...updateData } = v;
        await supabase.from("verbs").update(updateData).eq("verb_key", v.verb_key);
      }

      // Insert new verbs
      let newVerbIds: string[] = [];
      if (toInsert.length > 0) {
        const { data: insertedVerbs, error } = await supabase.from("verbs").insert(toInsert).select("id");
        if (error) throw error;
        newVerbIds = (insertedVerbs || []).map((v: any) => v.id);
      }

      // Auto-assign only NEW verbs to all students
      if (newVerbIds.length > 0 && students.length > 0) {
        for (const s of students) {
          const { data: maxRow } = await supabase
            .from("assignments")
            .select("task_no")
            .eq("student_id", s.id)
            .order("task_no", { ascending: false })
            .limit(1)
            .maybeSingle();

          const startNo = (maxRow?.task_no || 0) + 1;
          const assignmentRows = newVerbIds.map((verbId, idx) => ({
            student_id: s.id,
            verb_id: verbId,
            assigned_by: user?.id,
            task_no: startNo + idx,
          }));
          const { error: assignError } = await supabase.from("assignments").insert(assignmentRows);
          if (assignError) console.error("Auto-assign error for student", s.id, assignError);
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
              <Input type="number" value={newStudentQuota} onChange={(e) => setNewStudentQuota(e.target.value)}
                placeholder="Daily minutes (default: 10)" className="h-12 rounded-xl text-base" />
              <Button onClick={createStudent} disabled={creatingStudent} className="w-full h-12 rounded-xl font-bold text-base">
                {creatingStudent ? "Creating..." : "Create Student"}
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
            <CardContent className="pt-4 pb-3 text-center">
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
                Upload an Excel file with columns: verb_key, base_verb, meaning_en, example_short_1~3, example_long_1~3, situation_1~5
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

          <h3 className="text-lg font-bold">📚 Verb List ({verbs.length})</h3>
          <div className="space-y-2">
            {verbs.map((v) => (
              <Card key={v.id} className="rounded-xl kid-shadow">
                <CardContent className="pt-3 pb-2 flex items-center justify-between">
                  <div>
                    <span className="font-bold capitalize">{v.base_verb}</span>
                    <span className="text-sm text-muted-foreground ml-2">- {v.meaning_en}</span>
                  </div>
                  
                </CardContent>
              </Card>
            ))}
          </div>
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
