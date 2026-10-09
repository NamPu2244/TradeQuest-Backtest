import { cloud, invited } from "../../../lib/cloud";
import { supabase } from "../../../lib/supabase";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const parts = (await context.params).path;
  if (
    parts[0] !== "v1" ||
    parts[1] !== "replay" ||
    parts.some((p) => p === "..")
  )
    return new Response("Not found", { status: 404 });
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const hostname = (host || "").replace(/:\d+$/, "");
  const privateHost =
    /^(localhost|127\.0\.0\.1|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
      hostname,
    ) || hostname.endsWith(".local");
  if (!cloud() && !privateHost)
    return new Response("Local host required", { status: 403 });
  let originHost = "";
  try {
    originHost = origin ? new URL(origin).host : "";
  } catch {
    return new Response("Invalid origin", { status: 403 });
  }
  if (origin && originHost !== host)
    return new Response("Same origin required", { status: 403 });
  if (request.headers.get("sec-fetch-site") === "cross-site")
    return new Response("Same origin required", { status: 403 });
  try {
    const headers = new Headers();
    let base: string;
    if (cloud()) {
      if (!process.env.TQ_API_URL)
        return Response.json(
          { detail: "API service binding is missing" },
          { status: 503 },
        );
      const client = await supabase();
      const { data, error } = await client.auth.getClaims();
      if (error || !data)
        return Response.json({ detail: "Login required" }, { status: 401 });
      if (!invited(data.claims.sub))
        return Response.json(
          { detail: "Account is not invited" },
          { status: 403 },
        );
      // Identity was verified above; only extract the token for the private API, which verifies it again.
      const { data: session } = await client.auth.getSession();
      if (!session.session)
        return Response.json({ detail: "Login required" }, { status: 401 });
      headers.set("Authorization", `Bearer ${session.session.access_token}`);
      base = process.env.TQ_API_URL.replace(/\/$/, "");
    } else {
      const key =
        process.env.TQ_LOCAL_KEY ||
        (
          await readFile(
            path.join(
              process.env.TQ_DATA_DIR ||
                path.resolve(process.cwd(), "../../data"),
              "local.key",
            ),
            "utf8",
          )
        ).trim();
      headers.set("X-TradeQuest-Local", key);
      base = `http://127.0.0.1:${process.env.TQ_API_PORT || "8790"}`;
    }
    if (request.headers.has("content-type"))
      headers.set("content-type", request.headers.get("content-type")!);
    let body: ArrayBuffer | undefined;
    if (!["GET", "HEAD"].includes(request.method) && request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > (cloud() ? 4.25 : 9) * 1024 * 1024) {
          await reader.cancel();
          return Response.json(
            { detail: `Upload exceeds ${cloud() ? "4 MB CSV" : "9 MB"}` },
            { status: 413 },
          );
        }
        chunks.push(chunk.value);
      }
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      body = joined.buffer;
    }
    const upstream = await fetch(
      `${base}/api/${parts.map(encodeURIComponent).join("/")}${request.nextUrl.search}`,
      {
        method: request.method,
        headers,
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(60000),
      },
    );
    const returned = new Headers({ "Cache-Control": "private, no-store" });
    for (const k of ["content-type", "content-disposition"])
      if (upstream.headers.has(k)) returned.set(k, upstream.headers.get(k)!);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: returned,
    });
  } catch {
    return Response.json(
      {
        detail: cloud()
          ? "เชื่อมต่อ Cloud API ไม่ได้ กรุณาตรวจการตั้งค่า Vercel"
          : "เชื่อมต่อ API ไม่ได้ กรุณาเริ่ม scripts/dev.sh",
      },
      { status: 503 },
    );
  }
}
export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
};
