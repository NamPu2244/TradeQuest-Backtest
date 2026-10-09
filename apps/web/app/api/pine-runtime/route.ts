import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function GET() {
  const [runtime, worker] = await Promise.all([
    readFile(
      path.join(
        process.cwd(),
        "node_modules/pinets/dist/pinets.min.browser.js",
      ),
      "utf8",
    ),
    readFile(path.join(process.cwd(), "public/pine-worker.js"), "utf8"),
  ]);
  return new Response(runtime + "\n" + worker, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
