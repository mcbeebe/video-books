import { describe, expect, it, vi } from 'vitest';
import { backoffDelay, retry } from './retry.js';

describe('backoffDelay', () => {
  it('multiplies base by 2^n as the ceiling — full-jitter floor of random*ceiling', () => {
    const random = (): number => 0.5;
    // ceilings: 100, 200, 400 → halved by random=0.5
    expect(backoffDelay(0, 100, 8000, random)).toBe(50);
    expect(backoffDelay(1, 100, 8000, random)).toBe(100);
    expect(backoffDelay(2, 100, 8000, random)).toBe(200);
  });

  it('caps the ceiling at capMs', () => {
    const random = (): number => 0.5;
    // exp = 100 * 2^20 (huge), but cap = 1000 wins
    expect(backoffDelay(20, 100, 1000, random)).toBe(500);
  });

  it('returns 0 when random returns 0', () => {
    const random = (): number => 0;
    expect(backoffDelay(2, 100, 8000, random)).toBe(0);
  });

  it('returns ceiling-1 (or less) for random near 1', () => {
    const random = (): number => 0.999;
    expect(backoffDelay(2, 100, 8000, random)).toBe(399); // floor(0.999 * 400)
  });
});

describe('retry', () => {
  it('returns the first kept value without sleeping', async () => {
    const sleep = vi.fn(async () => undefined);
    const result = await retry(
      async () => 42,
      (o) => (o.ok ? { kind: 'keep', value: o.value } : { kind: 'retry', cause: o.cause }),
      { sleep },
    );
    expect(result).toBe(42);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries on transient failure then succeeds', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('transient');
        return 'finally';
      },
      (o) => (o.ok ? { kind: 'keep', value: o.value } : { kind: 'retry', cause: o.cause }),
      { sleep, random: () => 0 },
    );
    expect(result).toBe('finally');
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('throws the last cause after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      retry<string>(
        async () => {
          calls += 1;
          throw new Error(`call ${calls.toString()}`);
        },
        (o) => (o.ok ? { kind: 'keep', value: o.value } : { kind: 'retry', cause: o.cause }),
        { maxAttempts: 3, sleep: async () => undefined, random: () => 0 },
      ),
    ).rejects.toThrow('call 3');
    expect(calls).toBe(3);
  });

  it('honors decide() returning keep on a non-throwing failure result', async () => {
    const result = await retry(
      async () => ({ status: 200, body: 'ok' }),
      (o) =>
        o.ok && o.value.status >= 500
          ? { kind: 'retry', cause: new Error(o.value.body) }
          : o.ok
            ? { kind: 'keep', value: o.value }
            : { kind: 'retry', cause: o.cause },
      { sleep: async () => undefined, random: () => 0 },
    );
    expect(result.status).toBe(200);
  });

  it('decides retry on a soft-error response shape', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        return { status: calls === 1 ? 503 : 200, body: 'ok' };
      },
      (o) => {
        if (!o.ok) return { kind: 'retry', cause: o.cause };
        if (o.value.status >= 500) return { kind: 'retry', cause: new Error('soft') };
        return { kind: 'keep', value: o.value };
      },
      { sleep: async () => undefined, random: () => 0 },
    );
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
  });
});
