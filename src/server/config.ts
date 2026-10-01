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
  get google() {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  },
};
