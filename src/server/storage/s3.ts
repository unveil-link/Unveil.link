import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { Storage } from "./types";

/**
 * S3 / Cloudflare R2 compatible adapter (set S3_ENDPOINT for R2).
 * Implemented against the AWS SDK but NOT exercised in this repo's tests (no external accounts).
 * The bucket must be private; bytes are only ever streamed through the app.
 */
export class S3Storage implements Storage {
  private client: S3Client;
  private bucket: string;
  constructor() {
    const need = (n: string) => {
      const v = process.env[n];
      if (!v) throw new Error(`STORAGE_DRIVER=s3 requires env ${n}`);
      return v;
    };
    this.bucket = need("S3_BUCKET");
    this.client = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: {
        accessKeyId: need("S3_ACCESS_KEY_ID"),
        secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
      },
    });
  }
  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: contentType }),
    );
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async exists(key: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
