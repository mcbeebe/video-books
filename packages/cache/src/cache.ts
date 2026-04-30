import { createHash, randomBytes } from 'node:crypto';
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Derive a deterministic SHA256 hex digest from one or more string parts.
 * Parts are joined with a null byte (`\x00`) so `["ab", "c"]` and `["a", "bc"]`
 * yield different hashes. Use as the cache key for any external API call
 * (architecture §6.3-§6.5).
 *
 * @param parts - The components to hash, in caller-defined order.
 * @returns 64-character lowercase hex digest.
 * @example
 *   const key = deriveKey(prompt, styleAnchor, provider, model);
 */
export function deriveKey(...parts: string[]): string {
  const hash = createHash('sha256');
  parts.forEach((part, i) => {
    if (i > 0) hash.update('\x00');
    hash.update(part, 'utf8');
  });
  return hash.digest('hex');
}

/**
 * A content-addressable filesystem cache. Keys are caller-derived (typically
 * via {@link deriveKey}); same key implies same content, so duplicate writes
 * are safe (last-write-wins).
 */
export interface CacheStore {
  /** Returns true if the cache holds an entry for `(namespace, key, ext)`. */
  has(namespace: string, key: string, ext: string): Promise<boolean>;
  /** Returns the cached bytes, or `null` if no entry exists. */
  get(namespace: string, key: string, ext: string): Promise<Uint8Array | null>;
  /** Writes `data` to the cache. Atomic via tmpfile + rename. */
  set(namespace: string, key: string, ext: string, data: Uint8Array | string): Promise<void>;
  /** Deterministic on-disk path for the cache entry. Does not check existence. */
  pathFor(namespace: string, key: string, ext: string): string;
}

/**
 * Create a `CacheStore` rooted at `root`. The directory is created lazily on
 * the first `set`; namespace subdirectories are likewise created on demand.
 *
 * @param root - Absolute or cwd-relative path to the cache root.
 * @returns A `CacheStore` with `has` / `get` / `set` / `pathFor`.
 * @example
 *   const cache = createCache('cache');
 *   const key = deriveKey(prompt, styleAnchor, 'midjourney', 'v7');
 *   if (!(await cache.has('images', key, 'png'))) {
 *     await cache.set('images', key, 'png', await generate(prompt));
 *   }
 */
export function createCache(root: string): CacheStore {
  const pathFor = (namespace: string, key: string, ext: string): string =>
    join(root, namespace, `${key}.${ext}`);

  const has = async (namespace: string, key: string, ext: string): Promise<boolean> => {
    try {
      await access(pathFor(namespace, key, ext));
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  };

  const get = async (namespace: string, key: string, ext: string): Promise<Uint8Array | null> => {
    try {
      return await readFile(pathFor(namespace, key, ext));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  };

  const set = async (
    namespace: string,
    key: string,
    ext: string,
    data: Uint8Array | string,
  ): Promise<void> => {
    const dir = join(root, namespace);
    await mkdir(dir, { recursive: true });
    const tmpPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}-${key}.${ext}`);
    await writeFile(tmpPath, data);
    await rename(tmpPath, pathFor(namespace, key, ext));
  };

  return { has, get, set, pathFor };
}
