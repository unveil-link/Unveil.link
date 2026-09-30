/**
 * Private object storage. Implementations MUST NOT expose objects publicly;
 * access to bytes goes through the app (blurred preview route / signed original route).
 */
export interface Storage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
