export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api/v1/" + path, {
    ...options,
    headers: {
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  if (!r.ok) {
    const error = await r.json().catch(() => ({ detail: "API error" }));
    throw new Error(
      typeof error.detail === "string"
        ? error.detail
        : JSON.stringify(error.detail),
    );
  }
  return r.json();
}
export const num = (v: number | null | undefined, digits = 2) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("th-TH", { maximumFractionDigits: digits }).format(
        v,
      );
export const signed = (v: number | null | undefined, suffix = "") =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${num(v)}${suffix}`;
