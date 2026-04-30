import { describe, expect, it, vi } from 'vitest';
import { NarrationApiError, createNarrationClient } from './client.js';

const FAST_RETRY = { maxAttempts: 5, baseMs: 1, capMs: 1 };

function jsonResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

function audioResponse(bytes: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'audio/mpeg', ...headers },
  });
}

describe('createNarrationClient.generate', () => {
  it('rejects empty text without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
    });
    await expect(client.generate('')).rejects.toThrow(/non-empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('returns audio bytes and request-id on 200', async () => {
    const audio = new Uint8Array([0xff, 0xfb, 0x90, 0x44]);
    const fetchImpl = vi.fn(async () =>
      audioResponse(audio, { 'request-id': 'req-abc' }),
    ) as unknown as typeof fetch;
    const client = createNarrationClient({ apiKey: 'k', voiceId: 'v', fetch: fetchImpl });
    const res = await client.generate('hello');
    expect(Array.from(res.audio)).toEqual(Array.from(audio));
    expect(res.requestId).toBe('req-abc');
    expect(res.contentType).toBe('audio/mpeg');
  });

  it('sends voice_settings (snake_cased) in request body', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      captured = { url: String(url), init: init ?? {} };
      return audioResponse(new Uint8Array([1]));
    };
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      voiceSettings: { stability: 0.4, similarityBoost: 0.8, useSpeakerBoost: true },
      fetch: fetchImpl,
    });
    await client.generate('hi');
    expect(captured).not.toBeNull();
    const c = captured as unknown as { url: string; init: RequestInit };
    expect(c.url).toMatch(/\/v1\/text-to-speech\/v$/);
    const body = JSON.parse(String(c.init.body)) as {
      text: string;
      model_id: string;
      voice_settings: Record<string, unknown>;
    };
    expect(body.text).toBe('hi');
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.voice_settings).toEqual({
      stability: 0.4,
      similarity_boost: 0.8,
      use_speaker_boost: true,
    });
  });

  it('sends xi-api-key header', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return audioResponse(new Uint8Array([1]));
    };
    const client = createNarrationClient({
      apiKey: 'secret-k',
      voiceId: 'v',
      fetch: fetchImpl,
    });
    await client.generate('hi');
    expect(capturedHeaders['xi-api-key']).toBe('secret-k');
  });

  it('throws NarrationApiError(kind=auth) on 401 without retrying', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, 'bad key')) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    try {
      await client.generate('hi');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NarrationApiError);
      const e = (err as NarrationApiError).error;
      expect(e.kind).toBe('auth');
      if (e.kind === 'auth') expect(e.status).toBe(401);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    const audio = new Uint8Array([1, 2, 3]);
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3 ? jsonResponse(503, 'try later') : audioResponse(audio);
    }) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    const res = await client.generate('hi');
    expect(Array.from(res.audio)).toEqual(Array.from(audio));
    expect(calls).toBe(3);
  });

  it('throws NarrationApiError(kind=rate-limit) when retries exhausted on 429', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('slow down', { status: 429, headers: { 'retry-after': '2' } }),
    ) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: { ...FAST_RETRY, maxAttempts: 2 },
    });
    try {
      await client.generate('hi');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NarrationApiError);
      const e = (err as NarrationApiError).error;
      expect(e.kind).toBe('rate-limit');
      if (e.kind === 'rate-limit') {
        expect(e.status).toBe(429);
        expect(e.retryAfterMs).toBe(2000);
      }
    }
  });

  it('parses retry-after as HTTP-date when not numeric', async () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const fetchImpl = vi.fn(
      async () => new Response('slow', { status: 429, headers: { 'retry-after': future } }),
    ) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: { ...FAST_RETRY, maxAttempts: 1 },
    });
    try {
      await client.generate('hi');
      expect.fail();
    } catch (err) {
      const e = (err as NarrationApiError).error;
      if (e.kind === 'rate-limit') {
        expect(e.retryAfterMs).not.toBeNull();
        expect((e.retryAfterMs ?? 0) <= 5000).toBe(true);
      }
    }
  });

  it('translates AbortError into kind=aborted', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await client.generate('hi', { signal: controller.signal });
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(NarrationApiError);
      expect((err as NarrationApiError).error.kind).toBe('aborted');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('translates network throw into kind=network after retries', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'v',
      fetch: fetchImpl,
      retry: { ...FAST_RETRY, maxAttempts: 2 },
    });
    try {
      await client.generate('hi');
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(NarrationApiError);
      expect((err as NarrationApiError).error.kind).toBe('network');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('encodes voiceId in the URL path', async () => {
    let capturedUrl = '';
    const fetchImpl: typeof fetch = async (url) => {
      capturedUrl = String(url);
      return audioResponse(new Uint8Array([1]));
    };
    const client = createNarrationClient({
      apiKey: 'k',
      voiceId: 'voice/with slashes',
      fetch: fetchImpl,
    });
    await client.generate('hi');
    expect(capturedUrl).toContain('voice%2Fwith%20slashes');
  });
});
