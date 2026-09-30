import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError } from "./errors";
import { getSessionSellerId } from "./auth/session";
import { getSellerById, type Seller } from "./services/sellers";

type Handler<C> = (req: Request, ctx: C) => Promise<Response>;

/** Wraps a route handler: same-origin check for mutations + uniform JSON errors. */
export function api<C = unknown>(fn: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    try {
      if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
        const origin = req.headers.get("origin");
        if (origin && new URL(origin).host !== req.headers.get("host")) {
          throw new HttpError(403, "Cross-origin request blocked", "bad_origin");
        }
      }
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof HttpError) {
        return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
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
