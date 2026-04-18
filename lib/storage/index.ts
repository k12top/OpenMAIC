import { NoopStorageProvider } from './providers/noop';
import type { StorageProvider } from './types';

let _provider: StorageProvider | null = null;

function isMinioConfigured(): boolean {
  return !!(process.env.MINIO_ENDPOINT && process.env.MINIO_ACCESS_KEY);
}

export function getStorageProvider(): StorageProvider {
  if (!_provider) {
    if (isMinioConfigured()) {
      // Lazy-import to avoid pulling minio SDK when not configured
      const { MinioStorageProvider } = require('./providers/minio') as {
        MinioStorageProvider: new () => StorageProvider;
      };
      _provider = new MinioStorageProvider();
    } else {
      _provider = new NoopStorageProvider();
    }
  }
  return _provider;
}

export type { StorageProvider, StorageType } from './types';
