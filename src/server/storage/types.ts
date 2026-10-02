/**
 * Private object storage. Implementations MUST NOT expose objects publicly;
 * access to bytes goes through the app (blurred preview route / signed original route).
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Streaming API for large objects (videos): never buffers the object in memory. */
  putFile(key: string, filePath: string, contentType: string): Promise<void>;
  /** Size in bytes of a stored object (throws if missing). */
  size(key: string): Promise<number>;
  /** Streams [start, end] (inclusive byte offsets; whole object when omitted). */
  getStream(key: string, range?: { start: number; end: number }): Promise<import("node:stream").Readable>;
}
