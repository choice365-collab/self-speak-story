import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Users, BookOpen, Upload, DollarSign, Plus, Clock } from "lucide-react";
import * as XLSX from "xlsx";

type Student = {
  id: string;
  student_id: string | null;
  display_name: string | null;
  daily_quota_minutes: number;
};

type Verb = {
  id: string;
  verb: string;
  level: string | null;
  meaning_en: string | null;
};

type AssignmentView = {
  id: string;
  status: string;
  student_id: string;
  verb_id: string;
  profiles: { student_id: string | null; display_name: string | null } | null;
  verbs: { verb: string } | null;
};

export default function AdminDashboard() {
  const { profile, logout, user } = useAuth();
  const [students, setStudents] = useState<Student[]>([]);
  const [verbs, setVerbs] = useState<Verb[]>([]);
  const [assignments, setAssignments] = useState<AssignmentView[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // New student form
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentPin, setNewStudentPin] = useState("");
  const [newStudentQuota, setNewStudentQuota] = useState("10");
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Assign verb
  const [selectedStudent, setSelectedStudent] = useState("");
  const [selectedVerb, setSelectedVerb] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);

    const [studentsRes, verbsRes, assignmentsRes, settingsRes] = await Promise.all([
      supabase.from("profiles").select("id, student_id, display_name, daily_quota_minutes").eq("role", "student"),
      supabase.from("verbs").select("id, verb, level, meaning_en").order("verb"),
      supabase.from("assignments").select("id, status, student_id, verb_id, profiles!assignments_student_id_fkey(student_id, display_name), verbs(verb)"),
      supabase.from("admin_settings").select("key, value"),
    ]);

    if (studentsRes.data) setStudents(studentsRes.data as Student[]);
    if (verbsRes.data) setVerbs(verbsRes.data as Verb[]);
    if (assignmentsRes.data) setAssignments(assignmentsRes.data as any);
    if (settingsRes.data) {
      const s: Record<string, string> = {};
      settingsRes.data.forEach((r) => { s[r.key] = r.value; });
      setSettings(s);
    }
    setLoading(false);
  };

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

  const assignVerb = async () => {
    if (!selectedStudent || !selectedVerb) {
      toast.error("Select a student and verb");
      return;
    }
    const { error } = await supabase.from("assignments").insert({
      student_id: selectedStudent,
      verb_id: selectedVerb,
      assigned_by: user?.id,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Task assigned! ✅");
      setSelectedStudent(""); setSelectedVerb("");
      loadData();
    }
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any>(ws);

      const verbData = rows.map((row: any) => ({
        verb: row.verb || "",
        level: row.level || null,
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
      })).filter((v: any) => v.verb);

      if (verbData.length === 0) {
        toast.error("No valid verbs found in file");
        return;
      }

      const { error } = await supabase.from("verbs").insert(verbData);
      if (error) throw error;

      toast.success(`${verbData.length} verbs uploaded! 📚`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    }
    e.target.value = "";
  };

  const updateSetting = async (key: string, value: string) => {
    await supabase.from("admin_settings").update({ value, updated_at: new Date().toISOString() }).eq("key", key);
    setSettings((s) => ({ ...s, [key]: value }));
    toast.success("Setting updated");
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
            <div className="text-3xl font-black">{assignments.filter(a => a.status === "completed").length}</div>
            <div className="text-sm font-semibold text-muted-foreground">Completed</div>
          </CardContent>
        </Card>
        <Card className="rounded-2xl kid-shadow">
          <CardContent className="pt-4 pb-3 text-center">
            <DollarSign className="h-8 w-8 mx-auto mb-1 text-success" />
            <div className="text-3xl font-black">${settings.prepaid_credit_usd || "0"}</div>
            <div className="text-sm font-semibold text-muted-foreground">Credits</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="students" className="w-full">
        <TabsList className="w-full h-14 rounded-2xl mb-4">
          <TabsTrigger value="students" className="flex-1 text-base font-bold rounded-xl">Students</TabsTrigger>
          <TabsTrigger value="tasks" className="flex-1 text-base font-bold rounded-xl">Tasks</TabsTrigger>
          <TabsTrigger value="verbs" className="flex-1 text-base font-bold rounded-xl">Verbs</TabsTrigger>
          <TabsTrigger value="settings" className="flex-1 text-base font-bold rounded-xl">Settings</TabsTrigger>
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
          {students.map((s) => (
            <Card key={s.id} className="rounded-2xl kid-shadow">
              <CardContent className="pt-4 pb-3 flex items-center justify-between">
                <div>
                  <div className="font-bold text-lg">{s.display_name}</div>
                  <div className="text-sm text-muted-foreground">ID: {s.student_id} | {s.daily_quota_minutes} min/day</div>
                </div>
                <Badge variant="outline" className="rounded-full">
                  {assignments.filter(a => a.student_id === s.id && a.status === "completed").length}/
                  {assignments.filter(a => a.student_id === s.id).length} done
                </Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">📝 Assign Task</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <select value={selectedStudent} onChange={(e) => setSelectedStudent(e.target.value)}
                className="w-full h-12 rounded-xl border bg-background px-3 text-base">
                <option value="">Select Student</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.display_name} ({s.student_id})</option>
                ))}
              </select>
              <select value={selectedVerb} onChange={(e) => setSelectedVerb(e.target.value)}
                className="w-full h-12 rounded-xl border bg-background px-3 text-base">
                <option value="">Select Verb</option>
                {verbs.map((v) => (
                  <option key={v.id} value={v.id}>{v.verb} - {v.meaning_en}</option>
                ))}
              </select>
              <Button onClick={assignVerb} className="w-full h-12 rounded-xl font-bold text-base">
                <Plus className="h-5 w-5 mr-2" /> Assign Task
              </Button>
            </CardContent>
          </Card>

          <h3 className="text-lg font-bold">📊 All Assignments</h3>
          {assignments.map((a) => (
            <Card key={a.id} className="rounded-2xl kid-shadow">
              <CardContent className="pt-4 pb-3 flex items-center justify-between">
                <div>
                  <div className="font-bold">{a.profiles?.display_name || a.profiles?.student_id}</div>
                  <div className="text-sm text-muted-foreground">{a.verbs?.verb}</div>
                </div>
                <Badge variant={a.status === "completed" ? "secondary" : a.status === "in_progress" ? "default" : "outline"}
                  className="rounded-full capitalize">{a.status.replace("_", " ")}</Badge>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Verbs Tab */}
        <TabsContent value="verbs" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">📤 Upload Verbs (Excel)</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-3">
                Upload an Excel file with columns: verb, level, meaning_en, example_short_1~3, example_long_1~3, situation_1~5
              </p>
              <label className="block">
                <div className="flex items-center justify-center w-full h-16 rounded-xl border-2 border-dashed border-primary/30 hover:border-primary cursor-pointer transition-colors">
                  <Upload className="h-5 w-5 mr-2 text-primary" />
                  <span className="font-bold text-primary">Choose Excel File</span>
                </div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
              </label>
            </CardContent>
          </Card>

          <h3 className="text-lg font-bold">📚 Verb List ({verbs.length})</h3>
          <div className="space-y-2">
            {verbs.map((v) => (
              <Card key={v.id} className="rounded-xl kid-shadow">
                <CardContent className="pt-3 pb-2 flex items-center justify-between">
                  <div>
                    <span className="font-bold capitalize">{v.verb}</span>
                    <span className="text-sm text-muted-foreground ml-2">- {v.meaning_en}</span>
                  </div>
                  {v.level && <Badge variant="outline" className="rounded-full text-xs">{v.level}</Badge>}
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">⚙️ Settings</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="font-bold">Prepaid Credit (USD)</label>
                <div className="flex gap-2">
                  <Input value={settings.prepaid_credit_usd || "0"} 
                    onChange={(e) => setSettings(s => ({...s, prepaid_credit_usd: e.target.value}))}
                    className="h-12 rounded-xl text-base" type="number" />
                  <Button onClick={() => updateSetting("prepaid_credit_usd", settings.prepaid_credit_usd || "0")}
                    className="h-12 rounded-xl">Save</Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="font-bold">Student Daily Limit (minutes)</label>
                <div className="flex gap-2">
                  <Input value={settings.student_daily_limit_minutes || "10"}
                    onChange={(e) => setSettings(s => ({...s, student_daily_limit_minutes: e.target.value}))}
                    className="h-12 rounded-xl text-base" type="number" />
                  <Button onClick={() => updateSetting("student_daily_limit_minutes", settings.student_daily_limit_minutes || "10")}
                    className="h-12 rounded-xl">Save</Button>
                </div>
              </div>
              <div className="space-y-2">
                <label className="font-bold">Admin Daily Limit (minutes)</label>
                <div className="flex gap-2">
                  <Input value={settings.admin_daily_limit_minutes || "120"}
                    onChange={(e) => setSettings(s => ({...s, admin_daily_limit_minutes: e.target.value}))}
                    className="h-12 rounded-xl text-base" type="number" />
                  <Button onClick={() => updateSetting("admin_daily_limit_minutes", settings.admin_daily_limit_minutes || "120")}
                    className="h-12 rounded-xl">Save</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
