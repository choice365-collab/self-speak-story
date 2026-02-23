import { useEffect, useState } from "react";
import { formatVerbKey } from "@/lib/formatVerbKey";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { LogOut, Users, BookOpen, Upload, Download, DollarSign, Clock, Search, CheckCircle2, XCircle, Pencil, X, Save, Trash2, AlertTriangle, ChevronDown, FileText } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import * as XLSX from "xlsx";
import TranscriptReport from "@/components/TranscriptReport";

type Student = {
  id: string;
  student_id: string | null;
  display_name: string | null;
  daily_quota_minutes: number;
  difficulty_level: string;
  speech_speed: string;
  korean_hint_mode: boolean;
  group_name: string;
};

type Verb = {
  id: string;
  verb_key: string;
  base_verb: string;
  meaning_en: string | null;
  anchor_short_1: string | null;
  anchor_long_1: string | null;
  is_active: boolean;
  verb_no: number;
  display_no: number | null;
};

type AssignmentView = {
  id: string;
  status: string;
  task_no: number;
  is_enabled: boolean;
  student_id: string;
  verb_id: string;
  completed_at: string | null;
  completed_count: number;
  last_completed_score: number | null;
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
  const [sessionData, setSessionData] = useState<{ session_date: string; duration_seconds: number }[]>([]);
  const [todayUsage, setTodayUsage] = useState<DailyUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  // New student form
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newStudentPin, setNewStudentPin] = useState("");
  const [newStudentQuota, setNewStudentQuota] = useState("60");
  const [newStudentDifficulty, setNewStudentDifficulty] = useState<"low" | "medium" | "high">("medium");
  const [newStudentSpeed, setNewStudentSpeed] = useState<"slow" | "medium" | "fast">("medium");
  const [newStudentGroup, setNewStudentGroup] = useState("group0");
  const [creatingStudent, setCreatingStudent] = useState(false);

  // Edit student
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    display_name: string;
    pin: string;
    daily_quota_minutes: string;
    difficulty_level: string;
    speech_speed: string;
    group_name: string;
  }>({ display_name: "", pin: "", daily_quota_minutes: "", difficulty_level: "medium", speech_speed: "medium", group_name: "group0" });

  // Cost per minute estimate (OpenAI Realtime API: ~$0.06 input + ~$0.24 output)
  const COST_PER_MINUTE = 0.30;

  // Task filter
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [taskVerbSearch, setTaskVerbSearch] = useState("");
  const [taskRangeFrom, setTaskRangeFrom] = useState("");
  const [taskRangeTo, setTaskRangeTo] = useState("");

  // Assignment management
  const [assignSaving, setAssignSaving] = useState(false);

  // Verb filter & selection
  const [verbSearch, setVerbSearch] = useState("");
  const [verbRangeFrom, setVerbRangeFrom] = useState("");
  const [verbRangeTo, setVerbRangeTo] = useState("");
  const [verbFilterStatus, setVerbFilterStatus] = useState<"all" | "active" | "inactive">("all");
  const [selectedVerbIds, setSelectedVerbIds] = useState<Set<string>>(new Set());

  // Dev mode & hard delete
  const [devMode, setDevMode] = useState(false);
  const [hardDeleteVerbId, setHardDeleteVerbId] = useState<string | null>(null);
  const [hardDeleteConfirmText, setHardDeleteConfirmText] = useState("");
  const [hardDeleting, setHardDeleting] = useState(false);
  const [bulkHardDeleteOpen, setBulkHardDeleteOpen] = useState(false);
  const [bulkHardDeleteConfirm, setBulkHardDeleteConfirm] = useState("");
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState("");

  // Auto-assign toggle
  const [autoAssign, setAutoAssign] = useState(true);

  // Transcript report
  const [reportAssignmentId, setReportAssignmentId] = useState<string | null>(null);
  const [reportStudentName, setReportStudentName] = useState("");
  const [reportTaskLabel, setReportTaskLabel] = useState("");

  // Student delete
  const [deleteStudentId, setDeleteStudentId] = useState<string | null>(null);
  const [deletingStudent, setDeletingStudent] = useState(false);

  const deleteStudent = async (studentId: string) => {
    setDeletingStudent(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      if (!session) throw new Error("Not authenticated");
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ user_id: studentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStudents(prev => prev.filter(s => s.id !== studentId));
      setAssignments(prev => prev.filter(a => a.student_id !== studentId));
      setDeleteStudentId(null);
      toast.success("Student deleted 🗑️");
    } catch (e: any) {
      toast.error(e.message || "Delete failed");
    } finally {
      setDeletingStudent(false);
    }
  };

  const cascadeDeleteVerbs = async (verbIds: string[]): Promise<{ verbs: number; assignments: number; logs: number; sessions: number }> => {
    let totalAssignments = 0, totalLogs = 0, totalSessions = 0;
    // Batch in chunks to avoid query limits
    for (let i = 0; i < verbIds.length; i += 50) {
      const chunk = verbIds.slice(i, i + 50);
      const { data: relatedAssignments } = await supabase
        .from("assignments").select("id").in("verb_id", chunk);
      const assignmentIds = (relatedAssignments || []).map(a => a.id);
      totalAssignments += assignmentIds.length;
      if (assignmentIds.length > 0) {
        for (let j = 0; j < assignmentIds.length; j += 50) {
          const aChunk = assignmentIds.slice(j, j + 50);
          const { data: logDel } = await supabase.from("practice_logs").delete().in("assignment_id", aChunk).select("id");
          const { data: sessDel } = await supabase.from("speaking_sessions").delete().in("assignment_id", aChunk).select("id");
          totalLogs += (logDel || []).length;
          totalSessions += (sessDel || []).length;
        }
      }
      await supabase.from("assignments").delete().in("verb_id", chunk);
      await supabase.from("verbs").delete().in("id", chunk);
    }
    return { verbs: verbIds.length, assignments: totalAssignments, logs: totalLogs, sessions: totalSessions };
  };

  const hardDeleteVerb = async (verbId: string) => {
    setHardDeleting(true);
    try {
      await cascadeDeleteVerbs([verbId]);
      setVerbs(prev => prev.filter(v => v.id !== verbId));
      setAssignments(prev => prev.filter(a => a.verb_id !== verbId));
      setHardDeleteVerbId(null);
      setHardDeleteConfirmText("");
      toast.success("Verb permanently deleted 🗑️");
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      setHardDeleting(false);
    }
  };

  const bulkHardDelete = async () => {
    setHardDeleting(true);
    try {
      const ids = Array.from(selectedVerbIds);
      const result = await cascadeDeleteVerbs(ids);
      setVerbs(prev => prev.filter(v => !selectedVerbIds.has(v.id)));
      setAssignments(prev => prev.filter(a => !ids.includes(a.verb_id)));
      setSelectedVerbIds(new Set());
      setBulkHardDeleteOpen(false);
      setBulkHardDeleteConfirm("");
      toast.success(`Deleted: ${result.verbs} verbs, ${result.assignments} assignments, ${result.logs} logs, ${result.sessions} sessions 🗑️`);
    } catch (err: any) {
      toast.error(err.message || "Bulk delete failed");
    } finally {
      setHardDeleting(false);
    }
  };

  const deleteAllVerbs = async () => {
    setHardDeleting(true);
    try {
      const allIds = verbs.map(v => v.id);
      const result = await cascadeDeleteVerbs(allIds);
      setVerbs([]);
      setAssignments([]);
      setSelectedVerbIds(new Set());
      setDeleteAllOpen(false);
      setDeleteAllConfirm("");
      toast.success(`Deleted ALL: ${result.verbs} verbs, ${result.assignments} assignments, ${result.logs} logs, ${result.sessions} sessions 🗑️`);
    } catch (err: any) {
      toast.error(err.message || "Delete all failed");
    } finally {
      setHardDeleting(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const today = new Date().toISOString().split("T")[0];

    const [studentsRes, verbsRes, assignmentsRes, sessionsRes, usageRes, autoAssignRes] = await Promise.all([
      supabase.from("profiles").select("id, student_id, display_name, daily_quota_minutes, difficulty_level, speech_speed, korean_hint_mode, group_name").eq("role", "student"),
      supabase.from("verbs").select("id, verb_key, base_verb, meaning_en, anchor_short_1, anchor_long_1, is_active, verb_no, display_no").order("verb_no", { ascending: true }),
      supabase.from("assignments").select("id, status, task_no, is_enabled, student_id, verb_id, completed_at, completed_count, last_completed_score, profiles!assignments_student_id_profiles_fkey(student_id, display_name), verbs(base_verb, meaning_en)").order("task_no", { ascending: true }),
      supabase.from("speaking_sessions").select("session_date, duration_seconds"),
      supabase.from("daily_usage").select("student_id, used_seconds").eq("date", today),
      supabase.from("admin_settings").select("value").eq("key", "auto_assign_enabled").maybeSingle(),
    ]);

    if (studentsRes.data) setStudents(studentsRes.data as Student[]);
    if (autoAssignRes.data) {
      setAutoAssign(autoAssignRes.data.value !== "false");
    }
    if (verbsRes.data) setVerbs(verbsRes.data as Verb[]);
    if (assignmentsRes.data) setAssignments(assignmentsRes.data as any);
    if (sessionsRes.data) {
      setSessionData(sessionsRes.data as { session_date: string; duration_seconds: number }[]);
    }
    if (usageRes.data) setTodayUsage(usageRes.data as DailyUsageRow[]);
    setLoading(false);
  };

  const totalUsedSecondsToday = todayUsage.reduce((sum, u) => sum + u.used_seconds, 0);

  const _toggleAssignmentEnabled = async (assignmentId: string, currentEnabled: boolean) => {
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

  const toggleAutoAssign = async (checked: boolean) => {
    setAutoAssign(checked);
    await supabase.from("admin_settings").upsert({ key: "auto_assign_enabled", value: String(checked) }, { onConflict: "key" });
  };

  // Filtered assignments for Tasks tab
  const filteredAssignments = assignments.filter(a => {
    if (selectedStudentId) {
      if (selectedStudentId.startsWith("group:")) {
        const groupName = selectedStudentId.replace("group:", "");
        const groupStudentIds = new Set(students.filter(s => s.group_name === groupName).map(s => s.id));
        if (!groupStudentIds.has(a.student_id)) return false;
      } else {
        if (a.student_id !== selectedStudentId) return false;
      }
    }
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
            daily_quota_minutes: parseInt(newStudentQuota) || 60,
            difficulty_level: newStudentDifficulty,
            speech_speed: newStudentSpeed,
            group_name: newStudentGroup || "group0",
          }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success("Student created! 🎉");
      setNewStudentId(""); setNewStudentName(""); setNewStudentPin(""); setNewStudentQuota("60"); setNewStudentDifficulty("medium"); setNewStudentSpeed("medium"); setNewStudentGroup("group0");
      loadData();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCreatingStudent(false);
    }
  };

  // Edit student
  const startEditStudent = (s: Student) => {
    setEditingStudentId(s.id);
    setEditForm({
      display_name: s.display_name || "",
      pin: "",
      daily_quota_minutes: String(s.daily_quota_minutes),
      difficulty_level: s.difficulty_level,
      speech_speed: s.speech_speed,
      group_name: s.group_name || "group0",
    });
  };

  const saveEditStudent = async (s: Student) => {
    const updates: any = {};
    if (editForm.display_name !== (s.display_name || "")) updates.display_name = editForm.display_name;
    const quota = parseInt(editForm.daily_quota_minutes);
    if (!isNaN(quota) && quota !== s.daily_quota_minutes) updates.daily_quota_minutes = quota;
    if (editForm.difficulty_level !== s.difficulty_level) updates.difficulty_level = editForm.difficulty_level;
    if (editForm.speech_speed !== s.speech_speed) updates.speech_speed = editForm.speech_speed;
    if (editForm.group_name !== (s.group_name || "group0")) updates.group_name = editForm.group_name;
    

    if (Object.keys(updates).length > 0) {
      const { error } = await supabase.from("profiles").update(updates).eq("id", s.id);
      if (error) { toast.error(error.message); return; }
      setStudents(prev => prev.map(st => st.id === s.id ? { ...st, ...updates } : st));
    }

    // Update PIN if provided
    if (editForm.pin && editForm.pin.length === 4 && /^\d{4}$/.test(editForm.pin)) {
      const session = (await supabase.auth.getSession()).data.session;
      if (session) {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-user`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ user_id: s.id, pin: editForm.pin, student_id: s.student_id }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          toast.error(data.error || "Failed to update PIN");
          return;
        }
      }
    }

    setEditingStudentId(null);
    toast.success("Student updated! ✅");
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
              daily_quota_minutes: parseInt(row.daily_limit_min) || 60,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            toast.error(`Failed ${sid}: ${data.error}`);
            continue;
          }

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


  // Convert DB verb_key "get_receive" → Excel format "get (=receive)"
  const verbKeyToExcel = (vk: string): string => {
    const idx = vk.indexOf("_");
    if (idx > 0) {
      const expr = vk.slice(0, idx);
      const meaning = vk.slice(idx + 1).replace(/_/g, " ");
      return `${expr} (=${meaning})`;
    }
    return vk;
  };

  // Convert Excel format "get (=receive)" → DB verb_key "get_receive"
  const excelToVerbKey = (excel: string): string => {
    const match = excel.match(/^(.+?)\s*\(=(.+)\)$/);
    if (match) {
      const expr = match[1].trim();
      const meaning = match[2].trim().replace(/\s+/g, "_");
      return `${expr}_${meaning}`;
    }
    return excel.trim();
  };

  const downloadVerbLibrary = async () => {
    const { data, error } = await supabase
      .from("verbs")
      .select("verb_no, display_no, verb_key, base_verb, meaning_en, is_active, anchor_short_1, anchor_short_2, anchor_short_3, anchor_long_1, anchor_long_2, anchor_long_3, situation_seed_1, situation_seed_2, situation_seed_3, situation_seed_4")
      .order("verb_no", { ascending: true });
    if (error || !data) {
      toast.error(error?.message || "Failed to load verbs");
      return;
    }
    const excelData = data.map(row => ({
      ...row,
      verb_key: verbKeyToExcel(row.verb_key),
    }));
    const ws = XLSX.utils.json_to_sheet(excelData);
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
          verb_key: excelToVerbKey(row.verb_key || ""),
          base_verb: row.base_verb || "",
          meaning_en: row.meaning_en || null,
          anchor_short_1: row.anchor_short_1 || null,
          anchor_short_2: row.anchor_short_2 || null,
          anchor_short_3: row.anchor_short_3 || null,
          anchor_long_1: row.anchor_long_1 || null,
          anchor_long_2: row.anchor_long_2 || null,
          anchor_long_3: row.anchor_long_3 || null,
          situation_seed_1: row.situation_seed_1 || null,
          situation_seed_2: row.situation_seed_2 || null,
          situation_seed_3: row.situation_seed_3 || null,
          situation_seed_4: row.situation_seed_4 || null,
          created_by: user?.id,
        };
        if (hasIsActiveColumn) {
          base.is_active = row.is_active === false || row.is_active === "false" || row.is_active === 0 ? false : true;
        }
        if (row.display_no !== undefined && row.display_no !== null && row.display_no !== "") {
          base.display_no = parseInt(row.display_no);
          if (isNaN(base.display_no)) delete base.display_no;
        }
        return base;
      }).filter((v: any) => v.verb_key && v.base_verb);

      if (verbRows.length === 0) {
        toast.error("No valid verbs found in file");
        return;
      }

      const { data: existingVerbs } = await supabase
        .from("verbs")
        .select("id, verb_key");
      const existingMap = new Map((existingVerbs || []).map(v => [v.verb_key, v.id]));

      const toUpdate = verbRows.filter(v => existingMap.has(v.verb_key));
      const toInsert = verbRows.filter(v => !existingMap.has(v.verb_key));

      for (const v of toUpdate) {
        const { created_by: _cb, verb_key: _vk, ...updateData } = v;
        await supabase.from("verbs").update(updateData).eq("verb_key", v.verb_key);
      }

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

      if (autoAssign && newVerbIds.length > 0 && students.length > 0) {
        for (const s of students) {
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

  // KST date boundaries
  const getKSTDateBoundaries = () => {
    const now = new Date();
    const kstOffset = 9 * 60 * 60 * 1000;
    const kstNow = new Date(now.getTime() + kstOffset);
    const kstTodayStr = kstNow.toISOString().split("T")[0]; // YYYY-MM-DD in KST

    // 최근 2일: 어제 00:00 KST
    const kstYesterday = new Date(kstNow);
    kstYesterday.setUTCDate(kstYesterday.getUTCDate() - 1);
    const twoDayStart = kstYesterday.toISOString().split("T")[0];

    // 최근 일주일: 이번주 월요일 00:00 KST
    const kstDay = kstNow.getUTCDay(); // 0=Sun
    const daysSinceMonday = kstDay === 0 ? 6 : kstDay - 1;
    const kstMonday = new Date(kstNow);
    kstMonday.setUTCDate(kstMonday.getUTCDate() - daysSinceMonday);
    const weekStart = kstMonday.toISOString().split("T")[0];

    // 최근 한달: 이번달 1일 00:00 KST
    const monthStart = kstTodayStr.slice(0, 7) + "-01";

    return { twoDayStart, weekStart, monthStart };
  };

  const { twoDayStart, weekStart, monthStart } = getKSTDateBoundaries();

  const filterSessions = (startDate: string) => {
    return sessionData.filter(s => s.session_date >= startDate);
  };

  const twoDaySessions = filterSessions(twoDayStart);
  const weekSessions = filterSessions(weekStart);
  const monthSessions = filterSessions(monthStart);

  const calcCost = (sessions: typeof sessionData) => {
    const totalSec = sessions.reduce((sum, s) => sum + (s.duration_seconds || 0), 0);
    return { seconds: totalSec, count: sessions.length, cost: (totalSec / 60) * COST_PER_MINUTE };
  };

  const twoDayStats = calcCost(twoDaySessions);
  const weekStats = calcCost(weekSessions);
  const monthStats = calcCost(monthSessions);

  const estimatedCost = weekStats.cost;

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
            <DollarSign className="h-8 w-8 mx-auto mb-1 text-destructive" />
            <div className="text-3xl font-black">${estimatedCost.toFixed(2)}</div>
            <div className="text-sm font-semibold text-muted-foreground">Est. AI Cost (Week)</div>
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
          <Collapsible>
            <Card className="rounded-2xl kid-shadow">
              <CollapsibleTrigger className="w-full text-left">
                <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-muted/50 rounded-2xl transition-colors py-4">
                  <CardTitle className="text-lg">➕ Add Student</CardTitle>
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-3 pt-0">
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
                        placeholder="60" className="h-12 rounded-xl text-base pr-20" />
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
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold">Group</Label>
                    <Input value={newStudentGroup} onChange={(e) => setNewStudentGroup(e.target.value)}
                      placeholder="group0" className="h-12 rounded-xl text-base" />
                  </div>
                  <Button onClick={createStudent} disabled={creatingStudent} className="w-full h-12 rounded-xl font-bold text-base">
                    {creatingStudent ? "Creating..." : "Create Student"}
                  </Button>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Collapsible>
            <Card className="rounded-2xl kid-shadow">
              <CollapsibleTrigger className="w-full text-left">
                <CardHeader className="flex flex-row items-center justify-between cursor-pointer hover:bg-muted/50 rounded-2xl transition-colors py-4">
                  <CardTitle className="text-lg">📤 Upload / Download Students</CardTitle>
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-3 pt-0">
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
              </CollapsibleContent>
            </Card>
          </Collapsible>

          <Collapsible>
            <CollapsibleTrigger className="w-full flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-xl px-2 py-2 transition-colors">
              <h3 className="text-lg font-bold">📋 Student List ({students.length})</h3>
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3">
          {[...students].sort((a, b) => (a.display_name || a.student_id || "").localeCompare(b.display_name || b.student_id || "")).map((s) => {
            const studentAssignments = assignments.filter(a => a.student_id === s.id);
            const completed = studentAssignments.filter(a => a.status === "completed").length;
            const studentUsage = todayUsage.find(u => u.student_id === s.id);
            const isEditing = editingStudentId === s.id;

            return (
              <Card key={s.id} className="rounded-2xl kid-shadow">
                <CardContent className="pt-4 pb-3">
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-muted-foreground">Editing: {s.student_id}</span>
                        <Button size="sm" variant="ghost" onClick={() => setEditingStudentId(null)} className="rounded-xl h-8 w-8 p-0">
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input value={editForm.display_name} onChange={(e) => setEditForm(f => ({ ...f, display_name: e.target.value }))}
                        placeholder="Display Name" className="h-10 rounded-xl text-sm" />
                      <Input type="tel" value={editForm.pin}
                        onChange={(e) => setEditForm(f => ({ ...f, pin: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                        placeholder="New 4-digit PIN (leave empty to keep)" maxLength={4} className="h-10 rounded-xl text-sm tracking-widest" />
                      <div className="relative">
                        <Input type="number" value={editForm.daily_quota_minutes}
                          onChange={(e) => setEditForm(f => ({ ...f, daily_quota_minutes: e.target.value }))}
                          className="h-10 rounded-xl text-sm pr-20" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">min/day</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs font-semibold">Difficulty</Label>
                          <div className="flex rounded-lg border overflow-hidden mt-1">
                            {([["L", "low"], ["M", "medium"], ["H", "high"]] as const).map(([label, value]) => (
                              <button key={value} type="button"
                                onClick={() => setEditForm(f => ({ ...f, difficulty_level: value }))}
                                className={`flex-1 h-8 text-xs font-bold transition-colors ${editForm.difficulty_level === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                              >{label}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs font-semibold">Speed</Label>
                          <div className="flex rounded-lg border overflow-hidden mt-1">
                            {([["L", "slow"], ["M", "medium"], ["H", "fast"]] as const).map(([label, value]) => (
                              <button key={value} type="button"
                                onClick={() => setEditForm(f => ({ ...f, speech_speed: value }))}
                                className={`flex-1 h-8 text-xs font-bold transition-colors ${editForm.speech_speed === value ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                              >{label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs font-semibold">Group</Label>
                        <Input value={editForm.group_name} onChange={(e) => setEditForm(f => ({ ...f, group_name: e.target.value }))}
                          placeholder="group0" className="h-10 rounded-xl text-sm" />
                      </div>
                      <Button onClick={() => saveEditStudent(s)} className="w-full h-10 rounded-xl font-bold text-sm gap-2">
                        <Save className="h-4 w-4" /> Save Changes
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <div>
                          <div className="font-bold text-lg">{s.display_name ? `${s.display_name} (${s.student_id})` : `(${s.student_id})`}</div>
                          <div className="text-sm text-muted-foreground">{s.daily_quota_minutes} min/day</div>
                           <div className="text-xs text-muted-foreground">
                             Difficulty: {s.difficulty_level} | Speed: {s.speech_speed}
                           </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full">
                            {completed}/{studentAssignments.length} done
                          </Badge>
                          <Button size="sm" variant="ghost" onClick={() => startEditStudent(s)} className="rounded-xl h-8 w-8 p-0">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setDeleteStudentId(s.id)} className="rounded-xl h-8 w-8 p-0 text-destructive hover:text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      {studentUsage && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Today: {Math.floor(studentUsage.used_seconds / 60)}m {studentUsage.used_seconds % 60}s used
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            );
          })}
            </CollapsibleContent>
          </Collapsible>
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardContent className="pt-4 pb-3">
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={autoAssign}
                  onCheckedChange={(checked) => toggleAutoAssign(!!checked)}
                  className="mt-0.5"
                />
                <span className="text-sm text-muted-foreground">
                  Assignments are created automatically when students or verbs are added. You can also manually assign/unassign tasks per student below.
                </span>
              </label>
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
                {(() => {
                  const groups = [...new Set(students.map(s => s.group_name))].sort();
                  return groups.flatMap(g => [
                    <option key={`group:${g}`} value={`group:${g}`}>📁 {g} ({students.filter(s => s.group_name === g).length})</option>,
                    ...students
                      .filter(s => s.group_name === g)
                      .sort((a, b) => (a.display_name || a.student_id || "").localeCompare(b.display_name || b.student_id || ""))
                      .map(s => (
                        <option key={s.id} value={s.id}>&nbsp;&nbsp;&nbsp;{s.display_name || s.student_id}</option>
                      )),
                  ]);
                })()}
              </select>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                <Input
                  value={taskVerbSearch}
                  onChange={(e) => setTaskVerbSearch(e.target.value)}
                  placeholder="Search base verb..."
                  className="h-10 rounded-xl text-base pl-10"
                />
              </div>
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

              {/* Assign/Unassign Mode */}
              <div className="pt-2 border-t space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold">📝 Manage Assignments {!selectedStudentId ? "(All Students)" : selectedStudentId.startsWith("group:") ? `(${selectedStudentId.replace("group:", "")})` : ""}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={async () => {
                      setAssignSaving(true);
                      try {
                        const from = parseInt(taskRangeFrom);
                        const to = parseInt(taskRangeTo);
                        const visibleVerbs = verbs.filter(v => {
                          const no = v.display_no ?? v.verb_no;
                          if (!isNaN(from) && no < from) return false;
                          if (!isNaN(to) && no > to) return false;
                          if (taskVerbSearch && !v.base_verb.toLowerCase().includes(taskVerbSearch.toLowerCase())) return false;
                          return true;
                        });
                        const targetStudents = selectedStudentId.startsWith("group:") 
                          ? students.filter(s => s.group_name === selectedStudentId.replace("group:", ""))
                          : selectedStudentId ? [{ id: selectedStudentId }] : students;
                        let totalAssigned = 0;
                        for (const student of targetStudents) {
                          const existingVerbIds = new Set(assignments.filter(a => a.student_id === student.id).map(a => a.verb_id));
                          const toAssign = visibleVerbs.filter(v => !existingVerbIds.has(v.id));
                          if (toAssign.length === 0) continue;
                          const rows = toAssign.map(v => ({
                            student_id: student.id,
                            verb_id: v.id,
                            assigned_by: user?.id,
                            task_no: v.verb_no,
                          }));
                          const { data: inserted, error } = await supabase.from("assignments")
                            .insert(rows)
                            .select("id, status, task_no, is_enabled, student_id, verb_id, completed_at, completed_count, last_completed_score, profiles!assignments_student_id_profiles_fkey(student_id, display_name), verbs(base_verb, meaning_en)");
                          if (error) throw error;
                          if (inserted) {
                            setAssignments(prev => [...prev, ...(inserted as any)]);
                            totalAssigned += toAssign.length;
                          }
                        }
                        if (totalAssigned === 0) toast.info("All visible tasks are already assigned");
                        else toast.success(`${totalAssigned} tasks assigned! ✅`);
                      } catch (err: any) {
                        toast.error(err.message || "Failed to assign");
                      } finally {
                        setAssignSaving(false);
                      }
                    }} disabled={assignSaving}>
                      Select All
                    </Button>
                    <Button size="sm" variant="outline" className="rounded-xl text-xs" onClick={async () => {
                      setAssignSaving(true);
                      try {
                        const from = parseInt(taskRangeFrom);
                        const to = parseInt(taskRangeTo);
                        const visibleVerbIds = new Set(verbs.filter(v => {
                          const no = v.display_no ?? v.verb_no;
                          if (!isNaN(from) && no < from) return false;
                          if (!isNaN(to) && no > to) return false;
                          if (taskVerbSearch && !v.base_verb.toLowerCase().includes(taskVerbSearch.toLowerCase())) return false;
                          return true;
                        }).map(v => v.id));
                        const targetStudentIds = selectedStudentId.startsWith("group:")
                          ? new Set(students.filter(s => s.group_name === selectedStudentId.replace("group:", "")).map(s => s.id))
                          : selectedStudentId ? new Set([selectedStudentId]) : new Set(students.map(s => s.id));
                        const toRemove = assignments.filter(a => targetStudentIds.has(a.student_id) && visibleVerbIds.has(a.verb_id));
                        if (toRemove.length === 0) {
                          toast.info("No visible tasks are assigned");
                          return;
                        }
                        const ids = toRemove.map(a => a.id);
                        for (let i = 0; i < ids.length; i += 50) {
                          const chunk = ids.slice(i, i + 50);
                          const { error } = await supabase.from("assignments").delete().in("id", chunk);
                          if (error) throw error;
                        }
                        const removeSet = new Set(ids);
                        setAssignments(prev => prev.filter(a => !removeSet.has(a.id)));
                        toast.success(`${toRemove.length} tasks unassigned! 🗑️`);
                      } catch (err: any) {
                        toast.error(err.message || "Failed to unassign");
                      } finally {
                        setAssignSaving(false);
                      }
                    }} disabled={assignSaving}>
                      Deselect All
                    </Button>
                  </div>
                </div>

                {/* Verb checklist - for all selection modes */}
                {(() => {
                  const isIndividual = selectedStudentId && !selectedStudentId.startsWith("group:");
                  const isGroup = selectedStudentId.startsWith("group:");
                  const targetStudentIds = isGroup
                    ? students.filter(s => s.group_name === selectedStudentId.replace("group:", "")).map(s => s.id)
                    : isIndividual
                      ? [selectedStudentId]
                      : students.map(s => s.id);
                  const targetSet = new Set(targetStudentIds);
                  const targetCount = targetStudentIds.length;

                  const from = parseInt(taskRangeFrom);
                  const to = parseInt(taskRangeTo);
                  const filteredVerbs = verbs.filter(v => {
                    const no = v.display_no ?? v.verb_no;
                    if (!isNaN(from) && no < from) return false;
                    if (!isNaN(to) && no > to) return false;
                    if (taskVerbSearch && !v.base_verb.toLowerCase().includes(taskVerbSearch.toLowerCase())) return false;
                    return true;
                  });

                  // Build verb -> assignments map for target students
                  const verbAssignMap = new Map<string, AssignmentView[]>();
                  for (const a of assignments) {
                    if (!targetSet.has(a.student_id)) continue;
                    const list = verbAssignMap.get(a.verb_id) || [];
                    list.push(a);
                    verbAssignMap.set(a.verb_id, list);
                  }

                  const totalAssigned = assignments.filter(a => targetSet.has(a.student_id)).length;

                  return (
                    <>
                      <div className="max-h-64 overflow-y-auto space-y-1 rounded-xl border p-2">
                        {filteredVerbs.map(v => {
                          const verbAssigns = verbAssignMap.get(v.id) || [];
                          const assignedCount = verbAssigns.length;
                          const allAssigned = assignedCount >= targetCount && targetCount > 0;

                          return (
                            <label key={v.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${!v.is_active ? "opacity-50" : ""}`}>
                              <input
                                type="checkbox"
                                checked={allAssigned}
                                disabled={assignSaving}
                                onChange={async () => {
                                  setAssignSaving(true);
                                  try {
                                    if (allAssigned) {
                                      // Remove assignments for all target students
                                      const ids = verbAssigns.map(a => a.id);
                                      for (let i = 0; i < ids.length; i += 50) {
                                        const chunk = ids.slice(i, i + 50);
                                        const { error } = await supabase.from("assignments").delete().in("id", chunk);
                                        if (error) throw error;
                                      }
                                      const removeSet = new Set(ids);
                                      setAssignments(prev => prev.filter(a => !removeSet.has(a.id)));
                                    } else {
                                      // Add assignments for target students who don't have it
                                      const assignedStudentIds = new Set(verbAssigns.map(a => a.student_id));
                                      const toInsert = targetStudentIds.filter(sid => !assignedStudentIds.has(sid));
                                      if (toInsert.length > 0) {
                                        const rows = toInsert.map(sid => ({
                                          student_id: sid,
                                          verb_id: v.id,
                                          assigned_by: user?.id,
                                          task_no: v.verb_no,
                                        }));
                                        const { data: inserted, error } = await supabase.from("assignments")
                                          .insert(rows)
                                          .select("id, status, task_no, is_enabled, student_id, verb_id, completed_at, completed_count, last_completed_score, profiles!assignments_student_id_profiles_fkey(student_id, display_name), verbs(base_verb, meaning_en)");
                                        if (error) throw error;
                                        if (inserted) setAssignments(prev => [...prev, ...(inserted as any)]);
                                      }
                                    }
                                  } catch (err: any) {
                                    toast.error(err.message || "Failed");
                                  } finally {
                                    setAssignSaving(false);
                                  }
                                }}
                                className="h-4 w-4 rounded accent-primary shrink-0"
                              />
                              <span className="text-xs font-black text-primary shrink-0">#{v.display_no ?? v.verb_no}</span>
                              <span className="text-sm font-semibold truncate">{formatVerbKey(v.verb_key, v.meaning_en)}</span>
                              {!isIndividual && assignedCount > 0 && !allAssigned && (
                                <span className="text-xs text-muted-foreground ml-auto shrink-0">{assignedCount}/{targetCount}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                      <div className="text-xs text-muted-foreground text-center">
                        {totalAssigned} / {verbs.length * targetCount} assigned{!isIndividual && ` (${targetCount} students)`}
                      </div>
                    </>
                  );
                })()}
              </div>
            </CardContent>
          </Card>

          <h3 className="text-lg font-bold">📊 Tasks by Student</h3>
          {(() => {
            const sortedStudents = [...students].sort((a, b) => (a.display_name || a.student_id || "").localeCompare(b.display_name || b.student_id || ""));
            const groups = [...new Set(sortedStudents.map(s => s.group_name))].sort();

            return groups.map(groupName => {
              const groupStudents = sortedStudents.filter(s => s.group_name === groupName);
              const groupAssigns = assignments.filter(a => groupStudents.some(s => s.id === a.student_id));
              if (groupAssigns.length === 0) return null;

              return (
                <Collapsible key={groupName} defaultOpen>
                  <Card className="rounded-2xl kid-shadow">
                    <CollapsibleTrigger className="w-full text-left">
                      <CardContent className="pt-4 pb-3 flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-2xl transition-colors">
                        <div className="font-bold text-base">📁 {groupName}</div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full text-xs">{groupStudents.length} students</Badge>
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        </div>
                      </CardContent>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-4 pb-3 space-y-2">
                        {groupStudents.map((s) => {
                          const studentAssigns = assignments.filter(a => a.student_id === s.id);
                          if (studentAssigns.length === 0) return null;
                          const completed = studentAssigns.filter(a => a.status === "completed").length;
                          const isExpanded = selectedStudentId === s.id;

                          return (
                            <Collapsible key={s.id} open={isExpanded} onOpenChange={(open) => setSelectedStudentId(open ? s.id : "")}>
                              <div className="rounded-xl border">
                                <CollapsibleTrigger className="w-full text-left">
                                  <div className="px-3 py-2.5 flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded-xl transition-colors">
                                    <div>
                                      <div className="font-bold text-sm">{s.display_name ? `${s.display_name} (${s.student_id})` : `(${s.student_id})`}</div>
                                      <div className="text-xs text-muted-foreground">{completed}/{studentAssigns.length} completed</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="rounded-full text-xs">{studentAssigns.length} tasks</Badge>
                                      <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                                    </div>
                                  </div>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                  <div className="px-3 pb-2.5 space-y-1.5">
                                    {studentAssigns.map((a) => {
                                      const verb = verbs.find(v => v.id === a.verb_id);
                                      if (!verb) return null;
                                      return (
                                        <div key={a.id} className={`rounded-xl border p-2.5 ${!a.is_enabled ? "opacity-50 bg-muted/30" : "bg-background"}`}>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <Badge variant="outline" className="rounded-full text-xs font-black px-1.5 py-0 shrink-0">#{verb.display_no ?? verb.verb_no}</Badge>
                                            <span className="font-bold text-sm">{formatVerbKey(verb.verb_key, verb.meaning_en)}</span>
                                            {a.status === "completed" && (
                                              <>
                                                <Badge className="rounded-full bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px] px-1.5 py-0">
                                                  <CheckCircle2 className="h-3 w-3 mr-0.5" /> Done{a.completed_count > 1 ? ` x${a.completed_count}` : ""}
                                                </Badge>
                                                <Button
                                                  size="sm"
                                                  variant="ghost"
                                                  className="h-6 px-1.5 rounded-lg text-[10px]"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setReportAssignmentId(a.id);
                                                    setReportStudentName(s.display_name ? `${s.display_name} (${s.student_id})` : s.student_id || "");
                                                    setReportTaskLabel(`#${verb.display_no ?? verb.verb_no} ${formatVerbKey(verb.verb_key, verb.meaning_en)}`);
                                                  }}
                                                >
                                                  <FileText className="h-3 w-3 mr-0.5" /> 📋
                                                </Button>
                                              </>
                                            )}
                                          </div>
                                          <div className="text-sm text-muted-foreground mt-0.5">{verb.anchor_long_1 || verb.meaning_en || ""}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </CollapsibleContent>
                              </div>
                            </Collapsible>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              );
            });
          })()}
        </TabsContent>

        {/* Verbs Tab */}
        <TabsContent value="verbs" className="space-y-4">
          <Card className="rounded-2xl kid-shadow">
            <CardHeader><CardTitle className="text-lg">📤 Upload Verbs (Excel)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground mb-1">
                Columns: verb_key, base_verb, meaning_en, display_no (optional), is_active, anchor_short_1~3, anchor_long_1~3, situation_seed_1~4
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

          {/* Dev Mode Toggle */}
          <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-bold text-destructive">Dev Mode</span>
            </div>
            <Switch checked={devMode} onCheckedChange={setDevMode} />
          </div>

          {devMode && (
            <Button size="sm" variant="destructive" className="rounded-xl text-xs" onClick={() => {
              setDeleteAllOpen(true);
              setDeleteAllConfirm("");
            }}>
              <Trash2 className="h-3 w-3 mr-1" /> Delete ALL Verbs
            </Button>
          )}
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
            <Input
              value={verbSearch}
              onChange={(e) => setVerbSearch(e.target.value)}
              placeholder="Search base verb..."
              className="h-10 rounded-xl text-base pl-10"
            />
          </div>
          <div className="flex gap-2">
            <Input
              type="number" placeholder="From #" value={verbRangeFrom}
              onChange={(e) => setVerbRangeFrom(e.target.value)}
              className="h-10 rounded-xl text-base w-28"
            />
            <Input
              type="number" placeholder="To #" value={verbRangeTo}
              onChange={(e) => setVerbRangeTo(e.target.value)}
              className="h-10 rounded-xl text-base w-28"
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
                  {devMode && (
                    <Button size="sm" variant="destructive" className="rounded-xl text-xs" onClick={() => {
                      setBulkHardDeleteOpen(true);
                      setBulkHardDeleteConfirm("");
                    }}>
                      <Trash2 className="h-3 w-3 mr-1" /> Hard Delete Selected
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="rounded-xl text-xs" onClick={() => setSelectedVerbIds(new Set())}>Clear</Button>
                </div>
              </CardContent>
            </Card>
          )}

          {(() => {
            const searchLower = verbSearch.toLowerCase();
            const vFrom = parseInt(verbRangeFrom);
            const vTo = parseInt(verbRangeTo);
            const filtered = verbs.filter(v => {
              if (verbFilterStatus === "active" && !v.is_active) return false;
              if (verbFilterStatus === "inactive" && v.is_active) return false;
              if (searchLower && !v.base_verb.toLowerCase().includes(searchLower)) return false;
              const no = v.display_no ?? v.verb_no;
              if (!isNaN(vFrom) && no < vFrom) return false;
              if (!isNaN(vTo) && no > vTo) return false;
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
                            <Badge variant="outline" className="rounded-full text-xs font-black px-1.5 py-0 shrink-0">#{v.display_no ?? v.verb_no}</Badge>
                            <span className={`font-bold ${!v.is_active ? "text-muted-foreground" : ""}`}>{formatVerbKey(v.verb_key, v.meaning_en)}</span>
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
                          <span className={`text-sm ${!v.is_active ? "text-muted-foreground/60" : "text-muted-foreground"}`}>{v.anchor_long_1 || v.meaning_en}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Switch
                            checked={v.is_active}
                            onCheckedChange={async (checked) => {
                              const { error } = await supabase.from("verbs").update({ is_active: checked }).eq("id", v.id);
                              if (error) { toast.error(error.message); return; }
                              setVerbs(prev => prev.map(verb => verb.id === v.id ? { ...verb, is_active: checked } : verb));
                              toast.success(checked ? "Activated ✅" : "Deactivated 🗑️");
                            }}
                          />
                          {devMode && (
                            <Button
                              size="sm"
                              variant="destructive"
                              className="rounded-xl h-8 w-8 p-0"
                              onClick={() => { setHardDeleteVerbId(v.id); setHardDeleteConfirmText(""); }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
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
            <CardHeader><CardTitle className="text-lg">📊 Estimated AI Usage</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {[
                { label: "Recent 2 Days", stats: twoDayStats },
                { label: "This Week", stats: weekStats },
                { label: "This Month", stats: monthStats },
              ].map(({ label, stats }) => (
                <div key={label} className="border rounded-xl p-4 space-y-2">
                  <div className="text-center space-y-1">
                    <div className="text-3xl font-black text-destructive">{"$"}{stats.cost.toFixed(2)}</div>
                    <div className="text-sm text-muted-foreground font-semibold">{label}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <div className="text-lg font-black">{Math.floor(stats.seconds / 60)}</div>
                      <div className="text-xs text-muted-foreground">Minutes</div>
                    </div>
                    <div className="bg-muted rounded-lg p-2 text-center">
                      <div className="text-lg font-black">{stats.count}</div>
                      <div className="text-xs text-muted-foreground">Sessions</div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-semibold">💡 Cost Estimation</p>
                <p>Based on OpenAI Realtime API pricing (~$0.30/min).</p>
                <p>This is an approximation. Actual costs may vary.</p>
                <p>Check <a href="https://platform.openai.com/usage" target="_blank" rel="noopener noreferrer" className="text-primary underline font-bold">OpenAI Dashboard</a> for exact billing.</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Hard Delete Confirmation Dialog */}
      <Dialog open={!!hardDeleteVerbId} onOpenChange={(open) => { if (!open) { setHardDeleteVerbId(null); setHardDeleteConfirmText(""); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Permanently Delete Verb
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the verb and <strong>all related student data</strong> including assignments, practice logs, and session history. This action is <strong>irreversible</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-semibold">Type <span className="font-black text-destructive">DELETE</span> to confirm:</p>
            <Input
              value={hardDeleteConfirmText}
              onChange={(e) => setHardDeleteConfirmText(e.target.value)}
              placeholder="Type DELETE"
              className="h-12 rounded-xl text-base tracking-widest font-bold"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => { setHardDeleteVerbId(null); setHardDeleteConfirmText(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl font-bold"
              disabled={hardDeleteConfirmText !== "DELETE" || hardDeleting}
              onClick={() => hardDeleteVerbId && hardDeleteVerb(hardDeleteVerbId)}
            >
              {hardDeleting ? "Deleting..." : "Permanently Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Hard Delete Confirmation Dialog */}
      <Dialog open={bulkHardDeleteOpen} onOpenChange={(open) => { if (!open) { setBulkHardDeleteOpen(false); setBulkHardDeleteConfirm(""); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Permanently Delete {selectedVerbIds.size} Verbs
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{selectedVerbIds.size} selected verbs</strong> and <strong>all related student data</strong> including assignments, practice logs, and session history. This action is <strong>irreversible</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-semibold">Type <span className="font-black text-destructive">DELETE SELECTED</span> to confirm:</p>
            <Input
              value={bulkHardDeleteConfirm}
              onChange={(e) => setBulkHardDeleteConfirm(e.target.value)}
              placeholder="Type DELETE SELECTED"
              className="h-12 rounded-xl text-base tracking-widest font-bold"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => { setBulkHardDeleteOpen(false); setBulkHardDeleteConfirm(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl font-bold"
              disabled={bulkHardDeleteConfirm !== "DELETE SELECTED" || hardDeleting}
              onClick={bulkHardDelete}
            >
              {hardDeleting ? "Deleting..." : `Permanently Delete ${selectedVerbIds.size} Verbs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete ALL Verbs Confirmation Dialog */}
      <Dialog open={deleteAllOpen} onOpenChange={(open) => { if (!open) { setDeleteAllOpen(false); setDeleteAllConfirm(""); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> ⚠️ Delete ALL Verbs
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>ALL {verbs.length} verbs</strong> and <strong>every related record</strong> in the database — assignments, practice logs, and session history for <strong>all students</strong>. This action is <strong>completely irreversible</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm font-semibold">Type <span className="font-black text-destructive">DELETE ALL</span> to confirm:</p>
            <Input
              value={deleteAllConfirm}
              onChange={(e) => setDeleteAllConfirm(e.target.value)}
              placeholder="Type DELETE ALL"
              className="h-12 rounded-xl text-base tracking-widest font-bold"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => { setDeleteAllOpen(false); setDeleteAllConfirm(""); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl font-bold"
              disabled={deleteAllConfirm !== "DELETE ALL" || hardDeleting}
              onClick={deleteAllVerbs}
            >
              {hardDeleting ? "Deleting..." : `Delete ALL ${verbs.length} Verbs`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Student Confirmation Dialog */}
      <Dialog open={!!deleteStudentId} onOpenChange={(open) => { if (!open) setDeleteStudentId(null); }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" /> Delete Student
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the student account, all assignments, practice logs, speaking sessions, and usage data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm font-semibold">
            Student: {students.find(s => s.id === deleteStudentId)?.display_name || students.find(s => s.id === deleteStudentId)?.student_id}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" className="rounded-xl" onClick={() => setDeleteStudentId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="rounded-xl font-bold"
              disabled={deletingStudent}
              onClick={() => deleteStudentId && deleteStudent(deleteStudentId)}
            >
              {deletingStudent ? "Deleting..." : "Delete Student"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Transcript Report Dialog */}
      <TranscriptReport
        open={!!reportAssignmentId}
        onOpenChange={(open) => { if (!open) setReportAssignmentId(null); }}
        assignmentId={reportAssignmentId || ""}
        studentName={reportStudentName}
        taskLabel={reportTaskLabel}
        showDownload
      />
    </div>
  );
}
