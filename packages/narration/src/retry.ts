/**
 * Outcome of a single retry attempt — either keep the result or try again.
 */
export type RetryDecision<T> = { kind: 'keep'; value: T } | { kind: 'retry'; cause: unknown };

/**
 * Retry an async operation with exponential backoff + full jitter.
 *
 * @param attempt - The async operation; receives the 0-based attempt number.
 * @param decide  - Inspects the result/throw and returns `keep` or `retry`.
 * @param options - `maxAttempts` (≥1, default 5), `baseMs` (default 250), `capMs` (default 8000), `now` (clock injection for tests), `sleep` (sleep injection for tests).
 * @returns The first `keep`'d value.
 * @throws The last `retry` cause if `maxAttempts` is exhausted.
 */
export async function retry<T>(
  attempt: (n: number) => Promise<T>,
  decide: (result: { ok: true; value: T } | { ok: false; cause: unknown }) => RetryDecision<T>,
  options: {
    maxAttempts?: number;
    baseMs?: number;
    capMs?: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const baseMs = options.baseMs ?? 250;
  const capMs = options.capMs ?? 8000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastCause: unknown;
  for (let n = 0; n < maxAttempts; n += 1) {
    let outcome: { ok: true; value: T } | { ok: false; cause: unknown };
    try {
      outcome = { ok: true, value: await attempt(n) };
    } catch (cause) {
      outcome = { ok: false, cause };
    }
    const decision = decide(outcome);
    if (decision.kind === 'keep') return decision.value;
    lastCause = decision.cause;
    const delay = backoffDelay(n, baseMs, capMs, random);
    if (n + 1 < maxAttempts) await sleep(delay);
  }
  throw lastCause;
}

/**
 * Exponential backoff with full jitter — `random() * min(cap, base * 2^n)`.
 * Pure, exported for tests.
 */
export function backoffDelay(
  n: number,
  baseMs: number,
  capMs: number,
  random: () => number,
): number {
  const exp = baseMs * 2 ** n;
  const ceiling = Math.min(capMs, exp);
  return Math.floor(random() * ceiling);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
