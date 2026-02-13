import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { BookOpen, Shield } from "lucide-react";

export default function LoginPage() {
  const { login } = useAuth();
  const [role, setRole] = useState<"student" | "admin" | null>(null);
  const [loginId, setLoginId] = useState("");
  const [credential, setCredential] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!loginId || !credential) {
      toast.error("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      await login(role!, loginId, credential);
      toast.success("Welcome! 🎉");
    } catch (e: any) {
      toast.error(e.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="space-y-2">
            <h1 className="text-4xl font-black tracking-tight">
              🗣️ Speak by Yourself
            </h1>
            <p className="text-lg text-muted-foreground font-semibold">
              English Speaking Practice
            </p>
          </div>

          <div className="space-y-4">
            <Button
              onClick={() => setRole("student")}
              className="w-full h-20 text-2xl font-bold rounded-2xl kid-shadow hover:scale-[1.02] transition-transform"
              size="lg"
            >
              <BookOpen className="mr-3 h-8 w-8" />
              Student
            </Button>

            <Button
              onClick={() => setRole("admin")}
              variant="secondary"
              className="w-full h-20 text-2xl font-bold rounded-2xl kid-shadow hover:scale-[1.02] transition-transform"
              size="lg"
            >
              <Shield className="mr-3 h-8 w-8" />
              Admin
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md kid-shadow-lg rounded-3xl">
        <CardHeader className="text-center space-y-2 pb-2">
          <button
            onClick={() => { setRole(null); setLoginId(""); setCredential(""); }}
            className="text-muted-foreground text-sm self-start"
          >
            ← Back
          </button>
          <CardTitle className="text-3xl font-black">
            {role === "student" ? "🎓 Student Login" : "🛡️ Admin Login"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-2">
          <div className="space-y-2">
            <label className="text-lg font-bold">
              {role === "student" ? "Student ID" : "Admin ID"}
            </label>
            <Input
              value={loginId}
              onChange={(e) => setLoginId(e.target.value)}
              placeholder={role === "student" ? "Enter Student ID" : "Enter Admin ID"}
              className="h-14 text-lg rounded-xl"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-lg font-bold">
              {role === "student" ? "4-Digit PIN" : "Password"}
            </label>
            <Input
              type={role === "student" ? "tel" : "password"}
              value={credential}
              onChange={(e) => {
                if (role === "student") {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 4);
                  setCredential(val);
                } else {
                  setCredential(e.target.value);
                }
              }}
              placeholder={role === "student" ? "0000" : "Enter password"}
              className="h-14 text-lg rounded-xl tracking-widest"
              maxLength={role === "student" ? 4 : undefined}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
          </div>

          <Button
            onClick={handleLogin}
            disabled={loading || !loginId || !credential || (role === "student" && credential.length !== 4)}
            className="w-full h-16 text-xl font-bold rounded-2xl kid-shadow"
            size="lg"
          >
            {loading ? "Logging in..." : "Let's Go! 🚀"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
