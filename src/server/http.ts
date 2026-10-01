import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./errors";
import { getSessionSellerId } from "./auth/session";
import { getSellerById, type Seller } from "./services/sellers";
import { config } from "./config";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/**
 * Same-origin guard for mutating requests. A request WITHOUT an Origin header is allowed (non-browser
 * clients; browsers always send Origin on cross-origin POSTs). Any Origin that is present must parse as
 * an http(s) URL whose host matches the Host header (or APP_URL); "null", garbage and foreign origins -> 403.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin === null) return;
  let host: string | null = null;
  try {
    const u = new URL(origin);
    if (u.protocol === "http:" || u.protocol === "https:") host = u.host;
  } catch {
    /* falls through to 403 */
  }
  const reqHost = req.headers.get("host");
  let appHost: string | null = null;
  try {
    appHost = new URL(config.appUrl).host;
  } catch {}
  if (!host || (host !== reqHost && host !== appHost)) {
    throw new HttpError(403, "Cross-origin request blocked", "bad_origin");
  }
}

/** Wraps a route handler: same-origin check for mutations + uniform JSON errors. */
export function api<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        assertSameOrigin(req);
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers: e.headers });
      }
      if (e instanceof ZodError) {
        return NextResponse.json(
          { error: e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), code: "invalid_input" },
          { status: 400 },
        );
      }
      console.error("unhandled api error", e);
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export async function requireSeller(): Promise<Seller> {
  const id = await getSessionSellerId();
  const seller = id ? await getSellerById(id) : null;
  if (!seller) throw new HttpError(401, "Not authenticated", "unauthenticated");
  return seller;
}

export async function optionalSellerId(): Promise<string | null> {
  return getSessionSellerId();
}

export async function jsonBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body", "invalid_json");
  }
}
