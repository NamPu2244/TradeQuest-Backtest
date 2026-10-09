export const cloud = () =>
  process.env.TQ_DEPLOYMENT === "cloud" || process.env.VERCEL === "1";
export function invited(id?: string) {
  return (
    !!id &&
    (process.env.TQ_ALLOWED_USER_IDS || "")
      .split(",")
      .some((x) => x.trim() === id)
  );
}
export function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase is not configured");
  return { url, key };
}

export function appUrl() {
  const value = process.env.TQ_APP_URL;
  if (!value) throw new Error("TQ_APP_URL is missing");
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("Invalid TQ_APP_URL");
  return url.origin;
}
