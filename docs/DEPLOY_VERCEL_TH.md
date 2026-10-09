# Deploy Backtest บน Vercel

Cloud ใช้ Vercel Services (Next.js + FastAPI), Supabase (GitHub Login + PostgreSQL), private Cloudflare R2 (tick ปี 2025). เปิดเฉพาะเว็บ; API ภายในรับ token ที่ตรวจแล้วผ่าน service binding

## Vercel

Import repo นี้ branch **main**, Root Directory **./**, Application Preset **Services** ตามรูปที่เลือกไว้ `vercel.json` จัด routing/build ของสอง service ให้ ไม่ต้องแยก import และไม่ต้องตั้ง `TQ_API_URL` เอง

ตั้ง Environment Variables จาก [.env.example](../.env.example) ใน Production และ Preview:

- `TQ_DEPLOYMENT=cloud`
- `SUPABASE_URL`: Project URL
- `SUPABASE_PUBLISHABLE_KEY`: Publishable key หรือ legacy anon key; ไม่ใช้ service-role key
- `DATABASE_URL`: Supabase Connect → **Transaction pooler**; URL-encode password และ `sslmode=require`
- `TQ_APP_URL`: URL เว็บหลัก เช่น `https://your-project.vercel.app`
- `TQ_ALLOWED_USER_IDS`: Supabase user UUID ของคุณและเพื่อน คั่น comma; เริ่มว่างได้แต่ทุกบัญชียังเข้าแอปไม่ได้
- ค่า R2 อีก 4 ค่าในหัวข้อถัดไป

ใช้ Node.js 22 LTS หรือใหม่กว่าที่ Supabase SDK รองรับ ทุกค่าข้างต้นอยู่ server; ไม่มี `NEXT_PUBLIC_` secret API ปฏิเสธ SQLite บน Cloud

## Supabase และ GitHub Login

1. SQL Editor: เปิด [cloud-schema.sql](cloud-schema.sql) แล้ว Run หนึ่งครั้ง เพิ่ม 4 ตาราง/owner_id โดยไม่ reset; เปิด RLS และปฏิเสธ anon
2. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App: Homepage URL เป็น `TQ_APP_URL`, **Authorization callback URL** เป็น `https://YOUR_PROJECT.supabase.co/auth/v1/callback` (จาก Supabase provider page)
3. Supabase → Authentication → Sign In / Providers → GitHub: ใส่ OAuth Client ID/Client Secret และเปิด provider
4. Authentication → URL Configuration: Site URL เป็น `TQ_APP_URL`; Redirect URL เพิ่ม `TQ_APP_URL/auth/callback` แบบ exact URL สำหรับ Production/Preview แต่ละ URL ไม่ใช้ wildcard กว้าง
5. คุณกับเพื่อน Login ผ่าน GitHub คนละครั้ง แม้ยังเข้าแอปไม่ได้ จากนั้น Authentication → Users: คัดลอก UUID สองคนลง `TQ_ALLOWED_USER_IDS` ใน Vercel แล้ว Redeploy

สิทธิ์ตรวจจาก UUID ใน token ที่ตรวจลายเซ็นแล้ว ไม่เชื่อชื่อ GitHub หรือ user_metadata ที่ผู้ใช้แก้เองได้ API ตั้ง role/JWT identity และ invitation gate เฉพาะ transaction ทุกครั้ง และ ORM กรองเจ้าของอีกชั้น ข้อมูลตลาด `shared` อ่านได้แต่ผู้ใช้แก้ไม่ได้

ใช้ Supabase โปรเจกต์สำหรับ Backtest โดยเฉพาะ หากมี policy เดิมที่เปิดกว้าง ต้องตรวจ policy นั้นก่อน migration นี้ไม่ลบ policy ใคร ไม่ขอสิทธิ์อ่าน/เขียน GitHub repository และไม่ตั้งรหัสผ่านผู้ใช้ในแอป

## R2 และ tick ปี 2025

สร้าง private bucket เช่น `tradequest-market-data`; **ไม่เปิด Public Development URL/Custom Domain**

- Vercel ใช้ token **Object Read only** จำกัด bucket นี้
- เครื่องอัปโหลดใช้ **Object Read & Write** จำกัด bucket นี้ใน `.env.cloud` ชั่วคราว ไม่ใช้ write token ใน Vercel
- ตั้ง `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`

R2 Standard มี free allowance แต่การสมัครอาจขอข้อมูล billing และเกิน allowance มีค่าใช้จ่าย ไม่ใช่ฟรีแบบไม่จำกัด

อัปโหลด tick เดิมในเครื่อง โดยไม่ต้องดาวน์โหลดใหม่:

```bash
uv run --project apps/api --env-file .env.cloud python scripts/publish_market_cloud.py
```

ตัวอัปโหลดตรวจ SHA-256/ลำดับดัชนี, ใช้ชื่อ object แบบ immutable, ตรวจขนาด/hash metadata หลัง upload และลง catalog `shared` ใน PostgreSQL ปฏิเสธเขียนทับ object/dataset ที่ต่างจากเดิม ไม่อัปโหลดโปรไฟล์ ผลเทรด หรือ Pine ส่วนตัว

API อ่าน R2 เฉพาะ byte range พร้อมตรวจ ETag/Content-Range/ขนาด แคชไม่เกิน 48 MB ต่อ instance และส่งเฉพาะแท่งที่เปิดเผยแล้วไป browser ไม่โหลดทั้งปีเข้า Vercel ถ้ายังไม่ตั้ง R2 ใช้ DEMO/CSV ได้ แต่ BTC/XAU tick จริงจะยังไม่ขึ้นจน publish สำเร็จ CSV Cloud ไม่เกิน **4 MB**; Local ยังคง 8 MB

ไม่ส่ง secrets ในแชต/GitHub ให้กรอก dashboard หรือ `.env.cloud` ที่ Git ignore เท่านั้น

## ย้ายสำเนาโปรไฟล์เดิม (เลือกทำ)

หลัง publish tick แล้ว ใช้ UUID บัญชีคุณ:

```bash
uv run --project apps/api --env-file .env.cloud python scripts/import_cloud_state.py \
  --source-db data/backtest.sqlite3 --owner-id YOUR_SUPABASE_USER_UUID
```

ตัวนำเข้าใช้ SQLite snapshot รักษา IDs/เวลา/revision/ผลเทรด/drawings/Pine version และปฏิเสธเขียนทับ ID เดิม ข้อมูลส่วนตัวอยู่ PostgreSQL ของคุณ ไม่อยู่ repo public

**Local และ Cloud เป็นคนละที่เก็บ** นี่คือสำเนาครั้งเดียว ยังไม่มี automatic offline sync; การบันทึก Local ใหม่จะไม่ขึ้น Cloud โดยอัตโนมัติ

## ตรวจหลัง Deploy

- ไม่ Login เห็นหน้า GitHub Login; API ไม่ส่งข้อมูล
- Login สองบัญชี: Create/Load, CSV, Pine, ผลเทรด แยกกัน แม้รู้ ID ของอีกคนต้องเข้าถึงไม่ได้
- BTC/XAU catalog ร่วมกัน แต่โปรไฟล์/ตำแหน่ง Replay แยกกัน
- Play, TF, skip/rewind, หลาย Position, partial close, Review และ reload ทำงาน
- ไม่มีข้อมูลส่วนตัวใน public cache เงินทั้งหมดเป็น simulation

การทดสอบในเครื่องไม่ยืนยันการตั้งค่า Vercel จริง ต้องตรวจ OAuth/provider, PostgreSQL pooler/RLS, R2 และ service binding หลังตั้งค่าจริง

อ้างอิง: [Services](https://vercel.com/docs/services), [Bindings](https://vercel.com/docs/services/bindings), [GitHub Login](https://supabase.com/docs/guides/auth/social-login/auth-github), [SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [R2 pricing](https://developers.cloudflare.com/r2/pricing/).
