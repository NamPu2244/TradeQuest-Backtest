import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { cloud, authConfig } from "./lib/cloud";
export async function middleware(request: NextRequest) {
  if (!cloud()) return NextResponse.next();
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  let config;
  try {
    config = authConfig();
  } catch {
    return response;
  }
  const supabase = createServerClient(config.url, config.key, {
    cookieOptions: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.VERCEL === "1",
    },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set("Cache-Control", "private, no-store");
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await supabase.auth.getClaims();
  return response;
}
export const config = { matcher: ["/", "/login", "/api/v1/:path*"] };
