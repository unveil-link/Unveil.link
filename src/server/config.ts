// Central, lazily-evaluated environment config. Nothing here is read at import time
// so `next build` works without a populated environment.
function required(name: string, minLen = 1): string {
  const v = process.env[name];
  if (!v || v.length < minLen) {
    throw new Error(`Missing or too-short env var ${name} (see .env.example)`);
  }
  return v;
}

export const config = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get sessionSecret() {
    return required("SESSION_SECRET", 32);
  },
  get signedUrlSecret() {
    return required("SIGNED_URL_SECRET", 32);
  },
  get isProd() {
    return process.env.NODE_ENV === "production";
  },
  get storageDriver() {
    return (process.env.STORAGE_DRIVER ?? "local") as "local" | "s3";
  },
  get storageLocalDir() {
    return process.env.STORAGE_LOCAL_DIR ?? "./storage-data";
  },
  /** Default lifetime of signed download links (seconds). platform_settings.download_ttl_seconds wins when set. */
  get signedUrlTtlSeconds() {
    const n = Number(process.env.SIGNED_URL_TTL_SECONDS);
    return Number.isInteger(n) && n > 0 ? n : 24 * 60 * 60; // = FALLBACK_TTL_S
  },
  /** How many reverse-proxy hops append to X-Forwarded-For (client IP = Nth entry from the right). */
  get trustedProxyHops() {
    const n = Number(process.env.TRUSTED_PROXY_HOPS ?? 1);
    return Number.isInteger(n) && n >= 0 ? n : 1;
  },
  get rateLimitEnabled() {
    return process.env.RATE_LIMIT_ENABLED !== "0";
  },
  get mail() {
    return {
      transport: (process.env.MAIL_TRANSPORT ?? (process.env.NODE_ENV === "production" ? "" : "file")) as
        | "file" | "console" | "resend" | "postmark" | "",
      from: process.env.MAIL_FROM ?? "Unveil <no-reply@unveil.link>",
      devDir: process.env.MAIL_DEV_DIR ?? ".dev-mail",
      resendApiKey: process.env.RESEND_API_KEY,
      postmarkToken: process.env.POSTMARK_SERVER_TOKEN,
    };
  },
  /**
   * Payment layer. Provider-specific credentials stay in the provider modules; only the registry key and the
   * shared webhook-HMAC settings live here. See src/server/payments/.
   */
  get payments() {
    const tol = Number(process.env.PAYMENT_WEBHOOK_TOLERANCE_SECONDS);
    return {
      provider: (process.env.PAYMENT_PROVIDER?.trim() || "mock").toLowerCase(),
      /** HMAC-SHA256 key for webhook signatures (mock provider; real providers: our own HMAC in a pass-through field). */
      webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? "",
      webhookToleranceSeconds: Number.isInteger(tol) && tol > 0 ? tol : 300,
      /** Default processing fee (percent) of the mock processor; platform_settings.processing_fee_percent overrides. */
      mockProcessingFeePercent: process.env.MOCK_PROCESSING_FEE_PERCENT?.trim() || "12",
    };
  },
  /**
   * The mock processor (and every /api/dev/payments/* simulator route + the /pay/mock hosted page) is DEFAULT-DENY.
   * It is available only when
   *   - NODE_ENV is exactly "development" or "test" (next dev / vitest), or
   *   - MOCK_PAYMENTS_ENABLED=1 AND APP_URL's host is loopback (localhost / 127.0.0.1 / ::1).
   * Anything else (production, staging, unset/unknown NODE_ENV, a public APP_URL) is denied. The second form exists for
   * the repo's own e2e, which has to run a production *build* (`next start`) on this machine.
   */
  get mockPaymentsAllowed() {
    const env = process.env.NODE_ENV;
    if (env === "development" || env === "test") return true;
    if (process.env.MOCK_PAYMENTS_ENABLED !== "1") return false;
    try {
      const h = new URL(this.appUrl).hostname;
      return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
    } catch {
      return false;
    }
  },
  get google() {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  },
};
