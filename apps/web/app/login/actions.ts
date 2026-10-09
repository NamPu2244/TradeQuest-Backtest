"use server";
import { redirect } from "next/navigation";
import { supabase } from "../../lib/supabase";
import { cloud, appUrl } from "../../lib/cloud";
export async function login(): Promise<void> {
  if (!cloud()) redirect("/");
  let target: string | null = null;
  try {
    const client = await supabase();
    const { data, error } = await client.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: `${appUrl()}/auth/callback` },
    });
    if (!error) target = data.url;
  } catch {
    /* Show a configuration error without revealing credentials. */
  }
  if (!target) redirect("/login?error=configuration");
  redirect(target);
}
export async function logout() {
  if (cloud()) {
    const client = await supabase();
    await client.auth.signOut();
  }
  redirect("/login");
}
