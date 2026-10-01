import { NextResponse } from "next/server";
import { z } from "zod";
import { api, jsonBody } from "@/server/http";
import { HttpError } from "@/server/errors";
import { enforceIpLimit, clientIp } from "@/server/ratelimit";
import { admitLoginAttempt, resetLoginThrottle } from "@/server/ratelimit/login-throttle";
import { config } from "@/server/config";
import { auditFailedAdminLogin } from "@/server/admin/audit";
import { loginAdmin, setAdminCookie, requestUserAgent } from "@/server/admin/auth";

export const dynamic = "force-dynamic";
const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(200) });

/** Admin sign-in. Same-origin guarded (api()), per-IP limit, and the SAME progressive per-email delay as sellers (separate counter namespace). Uniform 401. */
export const POST = api(async (req) => {
  await enforceIpLimit("ADMIN_LOGIN_IP", req);
  const body = schema.parse(await jsonBody(req));
  const throttleId = `admin:${body.email}`;
  if (config.rateLimitEnabled) {
    const a = await admitLoginAttempt(throttleId);
    if (!a.admitted) {
      await auditFailedAdminLogin(body.email, "throttled", clientIp(req)); // bounded (coalesced per ip+email, global hourly cap)
      throw new HttpError(429, `Too many failed sign-in attempts. Please wait ${a.retryAfterSec} second${a.retryAfterSec === 1 ? "" : "s"} and try again.`, "login_delayed", { "Retry-After": String(a.retryAfterSec) });
    }
  }
  const r = await loginAdmin(body.email, body.password, await requestUserAgent(), clientIp(req));
  if (!r) throw new HttpError(401, "Invalid email or password", "invalid_credentials");
  await resetLoginThrottle(throttleId);
  await setAdminCookie(r.token);
  return NextResponse.json({ admin: r.admin }, { headers: { "Cache-Control": "no-store" } });
});
