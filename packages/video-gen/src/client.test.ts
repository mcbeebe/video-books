import { describe, expect, it, vi } from 'vitest';
import { createVideoClient } from './client.js';
import { VideoApiError } from './types.js';

const FAST_RETRY = { maxAttempts: 5, baseMs: 1, capMs: 1 };
const MP4_BYTES = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);

function jsonOk(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function mp4Ok(headers: Record<string, string> = {}): Response {
  return new Response(MP4_BYTES, {
    status: 200,
    headers: { 'content-type': 'video/mp4', ...headers },
  });
}

function errResp(status: number, body = ''): Response {
  return new Response(body, { status });
}

describe('createVideoClient.generate', () => {
  it('rejects empty motion without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    await expect(client.generate({ image: 'https://x', motion: '' })).rejects.toThrow(/non-empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('uses kling provider by default and returns video bytes', async () => {
    let capturedUrl = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        capturedUrl = String(url);
        return jsonOk({ video: { url: 'https://cdn/clip.mp4', content_type: 'video/mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    const r = await client.generate({ image: 'https://i/x.png', motion: 'slow push-in' });
    expect(capturedUrl).toContain('fal-ai/kling-video');
    expect(r.provider).toBe('kling');
    expect(Array.from(r.video)).toEqual(Array.from(MP4_BYTES));
    expect(r.sourceUrl).toBe('https://cdn/clip.mp4');
  });

  it('per-call provider overrides default', async () => {
    let capturedUrl = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        capturedUrl = String(url);
        return jsonOk({ video: { url: 'https://cdn/x.mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    await client.generate({ image: 'https://i', motion: 'm', provider: 'veo' });
    expect(capturedUrl).toContain('fal-ai/veo3');
  });

  it('encodes Uint8Array image as data URL in the body', async () => {
    let capturedBody: { image_url: string } = { image_url: '' };
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        capturedBody = JSON.parse(String(init.body)) as { image_url: string };
        return jsonOk({ video: { url: 'https://cdn/x.mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    await client.generate({ image: png, motion: 'm' });
    expect(capturedBody.image_url).toMatch(/^data:image\/png;base64,/);
  });

  it('honors provider bodyExtras (custom provider config)', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ video: { url: 'https://cdn/x.mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      providers: {
        kling: {
          name: 'kling',
          modelPath: 'fal-ai/kling-test',
          defaultDurationSec: 5,
          bodyExtras: { custom_flag: true, quality: 'high' },
        },
      },
      fetch: fetchImpl,
    });
    await client.generate({ image: 'https://i', motion: 'm' });
    expect(body.custom_flag).toBe(true);
    expect(body.quality).toBe('high');
  });

  it('uses provider default duration; per-call override wins', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ video: { url: 'https://cdn/x.mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    await client.generate({ image: 'https://i', motion: 'm' });
    expect(body.duration).toBe(5);
    await client.generate({ image: 'https://i', motion: 'm', durationSec: 10 });
    expect(body.duration).toBe(10);
  });

  it('parses videos[] array form when video object missing', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        return jsonOk({ videos: [{ url: 'https://cdn/array.mp4', duration: 5 }] });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
    });
    const r = await client.generate({ image: 'https://i', motion: 'm' });
    expect(r.sourceUrl).toBe('https://cdn/array.mp4');
    expect(r.durationSec).toBe(5);
  });

  it('throws bad-response when neither video nor videos[] present', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') return jsonOk({ unexpected: true });
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    try {
      await client.generate({ image: 'https://i', motion: 'm' });
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(VideoApiError);
      expect((err as VideoApiError).error.kind).toBe('bad-response');
    }
  });

  it('throws auth error on 401, no retry', async () => {
    const fetchImpl = vi.fn(async () => errResp(401, 'bad key')) as unknown as typeof fetch;
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    try {
      await client.generate({ image: 'https://i', motion: 'm' });
      expect.fail();
    } catch (err) {
      expect((err as VideoApiError).error.kind).toBe('auth');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        calls += 1;
        if (calls < 3) return errResp(503, 'busy');
        return jsonOk({ video: { url: 'https://cdn/x.mp4' } });
      }
      return mp4Ok();
    };
    const client = createVideoClient({
      apiKey: 'k',
      defaultProvider: 'kling',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    const r = await client.generate({ image: 'https://i', motion: 'm' });
    expect(Array.from(r.video)).toEqual(Array.from(MP4_BYTES));
    expect(calls).toBe(3);
  });
});
