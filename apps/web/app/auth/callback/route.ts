import { NextRequest, NextResponse } from "next/server";
import { supabase } from "../../../lib/supabase";
import { cloud, invited, appUrl } from "../../../lib/cloud";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!cloud()) return NextResponse.redirect(new URL("/", request.url));
  let base: string;
  try {
    base = appUrl();
  } catch {
    return Response.json(
      { detail: "Cloud login is not configured" },
      { status: 503 },
    );
  }
  const code = request.nextUrl.searchParams.get("code");
  if (code && code.length < 4096) {
    const client = await supabase();
    const { error } = await client.auth.exchangeCodeForSession(code);
    if (!error) {
      const verified = await client.auth.getClaims();
      if (!verified.error && invited(verified.data?.claims.sub))
        return NextResponse.redirect(new URL("/", base), {
          headers: { "Cache-Control": "private, no-store" },
        });
      await client.auth.signOut();
      return NextResponse.redirect(new URL("/login?error=not-invited", base));
    }
  }
  return NextResponse.redirect(new URL("/login?error=callback", base));
}
