import Backtest from "@/components/replay/Backtest";
import { redirect } from "next/navigation";
import { cloud, invited } from "../lib/cloud";
import { supabase } from "../lib/supabase";
import { logout } from "./login/actions";
export const dynamic = "force-dynamic";
export default async function Page() {
  let email: string | undefined;
  if (cloud()) {
    let verified;
    try {
      verified = await (await supabase()).auth.getClaims();
    } catch {
      return (
        <main className="cloud-login">
          <section>
            <h1>ตั้งค่า Cloud ยังไม่ครบ</h1>
            <p>
              เพิ่ม SUPABASE_URL และ SUPABASE_PUBLISHABLE_KEY ใน Vercel
              Environment Variables แล้ว Redeploy
            </p>
          </section>
        </main>
      );
    }
    if (verified.error || !invited(verified.data?.claims.sub))
      redirect("/login");
    email = verified.data?.claims.email || "GitHub";
  }
  return (
    <main className="standalone-app">
      {email && (
        <div className="cloud-account">
          <span>{email}</span>
          <form action={logout}>
            <button>ออกจากระบบ</button>
          </form>
        </div>
      )}
      <Backtest cloudMode={cloud()} />
    </main>
  );
}
