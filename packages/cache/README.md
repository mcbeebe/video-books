# @video-books/cache

Content-addressable filesystem cache. Used by every external-API stage to ensure repeat runs hit the cache and cost $0. Architecture §6.3-§6.5 and §10 (cost controls).

## Layout on disk

```
<root>/
├── images/<sha256>.png
├── clips/<sha256>.mp4
└── audio/<sha256>.mp3
```

`<root>` is whatever you pass to `createCache(root)` — typically `cache/` at the repo root.

## Exports

| Export                | Purpose                                                               |
| --------------------- | --------------------------------------------------------------------- |
| `deriveKey(...parts)` | SHA256 hex of null-byte-joined parts. Order- and separator-sensitive. |
| `createCache(root)`   | Factory — returns a `CacheStore` rooted at `root`.                    |
| `CacheStore`          | Interface with `has` / `get` / `set` / `pathFor`.                     |

## Usage

```ts
import { createCache, deriveKey } from '@video-books/cache';

const cache = createCache('cache');

// Per architecture §6.3 — image cache key is derived from these four inputs:
const key = deriveKey(prompt, styleAnchor, 'midjourney', 'v7');

if (await cache.has('images', key, 'png')) {
  return await cache.get('images', key, 'png'); // free, no API call
}

const bytes = await callMidjourney(prompt);
await cache.set('images', key, 'png', bytes);
return bytes;
```

## Guarantees

- **Atomic writes.** `set` writes to a tmpfile then `rename`s — a crash can never leave a partial file that future `get` reads as a hit.
- **Same-key, same-content.** Cache is content-addressable; if two writers race on the same key they're writing the same bytes, so last-write-wins is safe.
- **Misses are not errors.** `get` returns `null`, `has` returns `false`. Real I/O errors (permissions, disk full) still throw.

## Non-goals

- No memory tier — single-process batch jobs don't benefit.
- No eviction / TTL — pilot data is bounded; `rm -rf cache/` is the eviction strategy.
- No remote backend — local-first per architecture §2.

## Testing

```sh
pnpm --filter @video-books/cache test
```

Tests use real files under `os.tmpdir()` — no `vi.mock('node:fs')`.
