import { redirect } from "next/navigation";
import { cloud } from "../../lib/cloud";
import { LoginForm } from "./LoginForm";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!cloud()) redirect("/");
  return (
    <main className="cloud-login">
      <section>
        <span className="cloud-brand">TRADEQUEST</span>
        <h1>Backtest</h1>
        {error && (
          <p role="alert">
            {error === "not-invited"
              ? "บัญชีนี้ยังไม่ได้รับสิทธิ์ กรุณาให้เจ้าของเพิ่ม User ID จาก Supabase"
              : "ยังเข้าสู่ระบบไม่ได้ กรุณาตรวจการตั้งค่า GitHub ใน Supabase"}
          </p>
        )}
        <p>ฝึกเทรดในพื้นที่ของคุณ · เงินจำลอง</p>
        <LoginForm />
        <small>สำหรับบัญชีที่ได้รับเชิญ ข้อมูลแต่ละคนแยกจากกัน</small>
      </section>
    </main>
  );
}
