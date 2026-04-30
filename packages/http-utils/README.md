# @video-books/http-utils

Shared HTTP-call utilities. Currently: a generic `retry` with exponential backoff + full jitter, used by every external-API client (`narration`, `image-gen`, `video-gen`).

## Exports

| Export                               | Purpose                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `retry(attempt, decide)`             | Run an async op; let `decide` keep or retry each outcome.          |
| `backoffDelay(n, base, cap, random)` | Pure: `floor(random() * min(cap, base * 2^n))`. Exposed for tests. |
| `RetryDecision<T>`                   | `{ kind: 'keep'; value }` or `{ kind: 'retry'; cause }`.           |

`retry` injects `sleep` and `random` so call sites can be unit-tested deterministically.
