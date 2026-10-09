"use client";
import { useFormStatus } from "react-dom";
import { Github } from "lucide-react";
import { login } from "./actions";
function Button() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      <Github size={20} />
      {pending ? "กำลังเชื่อมต่อ GitHub…" : "เข้าสู่ระบบด้วย GitHub"}
    </button>
  );
}
export function LoginForm() {
  return (
    <form action={login} className="cloud-login-form">
      <Button />
    </form>
  );
}
