/** Tiny typed wrapper over fetch for the Unveil JSON API. Never throws: network failures become `{ network: true }`. */
export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number; // 0 = network error / unreadable response
      error: string;
      code?: string;
      network?: boolean;
      /** Seconds from the Retry-After header (429s), already parsed. */
      retryAfter?: number;
    };

/** Retry-After is either delta-seconds or an HTTP date. Returns whole seconds (>=1) or undefined. */
export function parseRetryAfter(v: string | null, now = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
  const t = Date.parse(v);
  if (Number.isFinite(t)) return Math.max(1, Math.ceil((t - now) / 1000));
  return undefined;
}

export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  const { json, ...rest } = init ?? {};
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch {
    return { ok: false, status: 0, error: "We couldn’t reach Unveil. Check your connection and try again.", network: true };
  }
  const body = (await res.json().catch(() => null)) as (Record<string, unknown> & { error?: string; code?: string }) | null;
  if (res.ok) return { ok: true, status: res.status, data: body as T };
  return {
    ok: false,
    status: res.status,
    error: typeof body?.error === "string" ? body.error : "Something went wrong. Please try again.",
    code: typeof body?.code === "string" ? body.code : undefined,
    retryAfter: res.status === 429 ? parseRetryAfter(res.headers.get("retry-after")) ?? 30 : undefined,
  };
}
