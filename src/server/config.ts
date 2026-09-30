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
  get google() {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    return id && secret ? { clientId: id, clientSecret: secret } : null;
  },
};
