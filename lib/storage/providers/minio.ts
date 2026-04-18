import { Client } from 'minio';
import { createLogger } from '@/lib/logger';
import type { StorageProvider, StorageType } from '../types';

const log = createLogger('MinioStorage');

const MIME_DEFAULTS: Record<StorageType, string> = {
  media: 'image/png',
  poster: 'image/png',
  audio: 'audio/mpeg',
};

export class MinioStorageProvider implements StorageProvider {
  private client: Client;
  private bucket: string;
  private publicBaseUrl: string | undefined;

  constructor() {
    this.client = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT || '9000', 10),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    });
    this.bucket = process.env.MINIO_BUCKET || 'openmaic';
    this.publicBaseUrl = process.env.MINIO_PUBLIC_URL?.replace(/\/$/, '');
  }

  async ensureBucket() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        log.info(`Created MinIO bucket: ${this.bucket}`);
      }
    } catch (err) {
      log.error('Failed to ensure MinIO bucket:', err);
    }
  }

  private objectKey(hash: string, type: StorageType): string {
    return `${type}/${hash}`;
  }

  async upload(
    hash: string,
    blob: Buffer,
    type: StorageType,
    mimeType?: string,
  ): Promise<string> {
    await this.ensureBucket();
    const key = this.objectKey(hash, type);
    const existing = await this.exists(hash, type);
    if (existing) return this.getUrl(hash, type);

    await this.client.putObject(this.bucket, key, blob, blob.length, {
      'Content-Type': mimeType || MIME_DEFAULTS[type] || 'application/octet-stream',
    });
    log.info(`Uploaded ${key} (${blob.length} bytes)`);
    return this.getUrl(hash, type);
  }

  async exists(hash: string, type: StorageType): Promise<boolean> {
    try {
      await this.client.statObject(this.bucket, this.objectKey(hash, type));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(hash: string, type: StorageType): string {
    const key = this.objectKey(hash, type);
    if (this.publicBaseUrl) {
      return `${this.publicBaseUrl}/${this.bucket}/${key}`;
    }
    return `/api/storage/${type}/${hash}`;
  }

  async batchExists(hashes: string[], type: StorageType): Promise<Set<string>> {
    const result = new Set<string>();
    await Promise.all(
      hashes.map(async (hash) => {
        if (await this.exists(hash, type)) result.add(hash);
      }),
    );
    return result;
  }

  async getObject(hash: string, type: StorageType): Promise<Buffer> {
    const key = this.objectKey(hash, type);
    const stream = await this.client.getObject(this.bucket, key);
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Uint8Array);
    }
    return Buffer.concat(chunks);
  }
}
