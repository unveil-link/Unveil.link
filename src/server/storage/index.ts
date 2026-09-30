import { config } from "../config";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./types";

const g = globalThis as unknown as { __unveilStorage?: Storage };

export function storage(): Storage {
  if (!g.__unveilStorage) {
    g.__unveilStorage =
      config.storageDriver === "s3" ? new S3Storage() : new LocalStorage(config.storageLocalDir);
  }
  return g.__unveilStorage;
}
export type { Storage };
