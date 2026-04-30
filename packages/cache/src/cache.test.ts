import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCache, deriveKey } from './cache.js';

describe('deriveKey', () => {
  it('produces a 64-char lowercase hex digest', () => {
    const key = deriveKey('a', 'b', 'c');
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic — same inputs yield same hash', () => {
    expect(deriveKey('a', 'b')).toBe(deriveKey('a', 'b'));
  });

  it('is order-sensitive', () => {
    expect(deriveKey('a', 'b')).not.toBe(deriveKey('b', 'a'));
  });

  it('separates parts so concatenation collisions are avoided', () => {
    expect(deriveKey('ab', 'c')).not.toBe(deriveKey('a', 'bc'));
  });

  it('handles a single argument', () => {
    expect(deriveKey('only')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('handles zero arguments (hash of empty input)', () => {
    expect(deriveKey()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('createCache', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcap-cache-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('pathFor joins root + namespace + key + ext deterministically', () => {
    const cache = createCache(dir);
    const p1 = cache.pathFor('images', 'abc123', 'png');
    const p2 = cache.pathFor('images', 'abc123', 'png');
    expect(p1).toBe(p2);
    expect(p1).toBe(join(dir, 'images', 'abc123.png'));
  });

  it('has returns false for a missing key', async () => {
    const cache = createCache(dir);
    expect(await cache.has('images', 'nope', 'png')).toBe(false);
  });

  it('get returns null for a missing key', async () => {
    const cache = createCache(dir);
    expect(await cache.get('images', 'nope', 'png')).toBeNull();
  });

  it('set then has returns true', async () => {
    const cache = createCache(dir);
    await cache.set('images', 'k', 'png', new Uint8Array([1, 2, 3]));
    expect(await cache.has('images', 'k', 'png')).toBe(true);
  });

  it('roundtrips binary bytes byte-for-byte', async () => {
    const cache = createCache(dir);
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    await cache.set('clips', 'k', 'mp4', bytes);
    const out = await cache.get('clips', 'k', 'mp4');
    if (out === null) throw new Error('expected cache hit');
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('roundtrips a UTF-8 string', async () => {
    const cache = createCache(dir);
    const text = 'hello — wilderness';
    await cache.set('audio', 'k', 'txt', text);
    const out = await cache.get('audio', 'k', 'txt');
    if (out === null) throw new Error('expected cache hit');
    expect(new TextDecoder().decode(out)).toBe(text);
  });

  it('creates the namespace directory on first write', async () => {
    const cache = createCache(dir);
    await cache.set('fresh-ns', 'k', 'bin', new Uint8Array([1]));
    const s = await stat(join(dir, 'fresh-ns'));
    expect(s.isDirectory()).toBe(true);
  });

  it('last-write-wins on duplicate key (same namespace/ext)', async () => {
    const cache = createCache(dir);
    await cache.set('images', 'k', 'png', new Uint8Array([1, 2]));
    await cache.set('images', 'k', 'png', new Uint8Array([9, 9, 9]));
    const out = await cache.get('images', 'k', 'png');
    if (out === null) throw new Error('expected cache hit');
    expect(Array.from(out)).toEqual([9, 9, 9]);
  });

  it('does not leave tmpfiles behind after a successful set', async () => {
    const cache = createCache(dir);
    await cache.set('images', 'k', 'png', new Uint8Array([1, 2]));
    const entries = await readdir(join(dir, 'images'));
    expect(entries).toEqual(['k.png']);
  });

  it('namespaces are isolated — same key, different namespace', async () => {
    const cache = createCache(dir);
    await cache.set('images', 'k', 'png', new Uint8Array([1]));
    expect(await cache.has('clips', 'k', 'png')).toBe(false);
  });
});
