/**
 * Content-addressed blob storage.
 *
 * `data.md` §4: "Artifact内容先写临时文件，fsync，原子rename到Hash路径；事务引用
 * Hash。数据库事务失败留下的无引用文件由离线GC清理；引用不存在文件返回
 * ARTIFACT_MISSING". Every write is verified against its own hash before the rename,
 * so a truncated or corrupted write can never become addressable.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { StorageError } from './errors.js';
import { sha256 } from './ids.js';

export interface BlobRef {
  readonly hash: string;
  /** Path relative to the project state directory, e.g. `blobs/ab/<hash>`. */
  readonly relativePath: string;
  readonly bytes: number;
}

export interface BlobStoreOptions {
  /** Directory that holds `blobs/`; one per project. */
  readonly root: string;
}

export class BlobStore {
  private readonly root: string;
  private readonly blobsRoot: string;

  constructor(options: BlobStoreOptions) {
    this.root = options.root;
    this.blobsRoot = join(options.root, 'blobs');
  }

  /** Absolute path of a blob, rejecting anything that escapes the store. */
  resolve(relativePath: string): string {
    if (relativePath.startsWith('/') || relativePath.includes('..')) {
      throw new StorageError('NOT_FOUND', `unsafe blob path ${relativePath}`, { relativePath });
    }
    return join(this.root, relativePath);
  }

  /**
   * Writes a blob and returns its address.
   *
   * Writing the same content twice is a no-op, because the name is the hash.
   */
  write(content: string | Uint8Array): BlobRef {
    const buffer =
      typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const hash = sha256(buffer);
    const relativePath = join('blobs', hash.slice(0, 2), hash);
    const target = join(this.root, relativePath);
    if (existsSync(target)) {
      return { hash, relativePath, bytes: buffer.byteLength };
    }
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
    const fd = openSync(temporary, 'w');
    try {
      writeSync(fd, buffer);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    const written = readFileSync(temporary);
    if (sha256(written) !== hash) {
      rmSync(temporary, { force: true });
      throw new StorageError('BLOB_MISMATCH', 'blob verification failed before rename', { hash });
    }
    renameSync(temporary, target);
    return { hash, relativePath, bytes: buffer.byteLength };
  }

  has(relativePath: string): boolean {
    return existsSync(this.resolve(relativePath));
  }

  /** Reads a blob; `ARTIFACT_MISSING` is surfaced as `BLOB_MISSING`. */
  read(relativePath: string): Buffer {
    const target = this.resolve(relativePath);
    if (!existsSync(target)) {
      throw new StorageError('BLOB_MISSING', `blob ${relativePath} is missing`, { relativePath });
    }
    return readFileSync(target);
  }

  /** Reads a blob and verifies it still matches the recorded hash. */
  readVerified(relativePath: string, expectedHash: string): Buffer {
    const content = this.read(relativePath);
    if (sha256(content) !== expectedHash) {
      throw new StorageError('BLOB_MISMATCH', `blob ${relativePath} does not match its hash`, {
        relativePath,
        expectedHash,
      });
    }
    return content;
  }

  size(relativePath: string): number {
    const target = this.resolve(relativePath);
    if (!existsSync(target)) {
      throw new StorageError('BLOB_MISSING', `blob ${relativePath} is missing`, { relativePath });
    }
    return statSync(target).size;
  }

  remove(relativePath: string): boolean {
    const target = this.resolve(relativePath);
    if (!existsSync(target)) return false;
    rmSync(target);
    return true;
  }

  /** All stored blob paths, used by the offline GC sweep. */
  list(): string[] {
    if (!existsSync(this.blobsRoot)) return [];
    const found: string[] = [];
    for (const bucket of readdirSync(this.blobsRoot)) {
      const bucketPath = join(this.blobsRoot, bucket);
      if (!statSync(bucketPath).isDirectory()) continue;
      for (const name of readdirSync(bucketPath)) {
        found.push(join('blobs', bucket, name));
      }
    }
    return found;
  }

  /**
   * Deletes blobs that no longer have a database reference.
   *
   * `data.md` §4 makes this an offline action: pass the set of referenced paths
   * read from a consistent snapshot.
   */
  collectGarbage(referenced: ReadonlySet<string>): string[] {
    const removed: string[] = [];
    for (const path of this.list()) {
      if (referenced.has(path)) continue;
      this.remove(path);
      removed.push(path);
    }
    return removed;
  }
}
