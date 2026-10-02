import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import type { Readable } from "node:stream";
import path from "node:path";
import type { Storage } from "./types";

/** Filesystem storage rooted OUTSIDE public/ (default ./storage-data, gitignored). */
export class LocalStorage implements Storage {
  private root: string;
  constructor(dir: string) {
    this.root = path.resolve(dir);
  }
  private resolve(key: string): string {
    const p = path.resolve(this.root, key);
    if (p !== this.root && !p.startsWith(this.root + path.sep)) {
      throw new Error("invalid storage key");
    }
    return p;
  }
  async put(key: string, data: Buffer): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fs.writeFile(p, data, { mode: 0o600 });
  }
  get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }
  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string): Promise<void> {
    const p = this.resolve(key);
    await fs.rm(p, { force: true });
    // Best effort: drop the per-drop directory once its last object is gone (rmdir only succeeds on an empty dir).
    const dir = path.dirname(p);
    if (dir !== this.root) await fs.rmdir(dir).catch(() => {});
  }
  async putFile(key: string, filePath: string): Promise<void> {
    const p = this.resolve(key);
    await fs.mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await fs.copyFile(filePath, p);
    await fs.chmod(p, 0o600);
  }
  async size(key: string): Promise<number> {
    return (await fs.stat(this.resolve(key))).size;
  }
  async getStream(key: string, range?: { start: number; end: number }): Promise<Readable> {
    const p = this.resolve(key);
    await fs.access(p);
    return createReadStream(p, range);
  }
}
