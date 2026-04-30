import { describe, expect, it, vi } from 'vitest';
import { ImageApiError, createImageClient } from './client.js';

const FAST_RETRY = { maxAttempts: 5, baseMs: 1, capMs: 1 };

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonOk(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function pngOk(bytes: Uint8Array = PNG_BYTES, headers: Record<string, string> = {}): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'image/png', ...headers },
  });
}

function errResp(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

/** Build a fetch stub that returns submit response on URL #1 and image on URL #2. */
function twoStepFetch(submit: Response, image: Response): typeof fetch {
  let calls = 0;
  return async (): Promise<Response> => {
    calls += 1;
    if (calls === 1) return submit.clone();
    return image.clone();
  };
}

describe('createImageClient.generate', () => {
  it('rejects empty prompt without calling fetch', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = createImageClient({ apiKey: 'k', model: 'm', fetch: fetchImpl });
    await expect(client.generate('')).rejects.toThrow(/non-empty/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('appends styleAnchor to the prompt sent to the provider', async () => {
    let capturedBody = '';
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        capturedBody = String(init.body);
        return jsonOk({ images: [{ url: 'https://cdn/img.png', content_type: 'image/png' }] });
      }
      return pngOk();
    };
    const client = createImageClient({
      apiKey: 'k',
      model: 'fal-ai/flux-pro/v1.1',
      styleAnchor: 'wilderness oil painting --ar 16:9',
      fetch: fetchImpl,
    });
    await client.generate('high meadow at dawn');
    const body = JSON.parse(capturedBody) as { prompt: string };
    expect(body.prompt).toBe('high meadow at dawn wilderness oil painting --ar 16:9');
  });

  it('returns image bytes plus dimensions and sourceUrl', async () => {
    const fetchImpl = twoStepFetch(
      jsonOk({
        images: [{ url: 'https://cdn/x.png', content_type: 'image/png', width: 1024, height: 576 }],
        request_id: 'req-9',
      }),
      pngOk(),
    );
    const client = createImageClient({ apiKey: 'k', model: 'm', fetch: fetchImpl });
    const r = await client.generate('a meadow');
    expect(Array.from(r.image)).toEqual(Array.from(PNG_BYTES));
    expect(r.width).toBe(1024);
    expect(r.height).toBe(576);
    expect(r.sourceUrl).toBe('https://cdn/x.png');
    expect(r.requestId).toBe('req-9');
    expect(r.contentType).toBe('image/png');
  });

  it('sends Authorization header in fal-ai shape', async () => {
    let captured = '';
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        captured = (init.headers as Record<string, string>).authorization ?? '';
        return jsonOk({ images: [{ url: 'https://cdn/x.png' }] });
      }
      return pngOk();
    };
    const client = createImageClient({ apiKey: 'sk-test', model: 'm', fetch: fetchImpl });
    await client.generate('p');
    expect(captured).toBe('Key sk-test');
  });

  it('passes optional imageSize / negativePrompt / seed in the body', async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        body = JSON.parse(String(init.body)) as Record<string, unknown>;
        return jsonOk({ images: [{ url: 'https://cdn/x.png' }] });
      }
      return pngOk();
    };
    const client = createImageClient({
      apiKey: 'k',
      model: 'm',
      imageSize: 'landscape_16_9',
      fetch: fetchImpl,
    });
    await client.generate('p', { negativePrompt: 'no people', seed: 42 });
    expect(body).toMatchObject({
      prompt: 'p',
      image_size: 'landscape_16_9',
      negative_prompt: 'no people',
      seed: 42,
    });
  });

  it('throws ImageApiError(kind=auth) on 401 without retrying', async () => {
    const fetchImpl = vi.fn(async () => errResp(401, 'bad key')) as unknown as typeof fetch;
    const client = createImageClient({
      apiKey: 'k',
      model: 'm',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    try {
      await client.generate('p');
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ImageApiError);
      expect((err as ImageApiError).error.kind).toBe('auth');
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then succeeds', async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') {
        calls += 1;
        if (calls < 3) return errResp(503, 'busy');
        return jsonOk({ images: [{ url: 'https://cdn/x.png' }] });
      }
      return pngOk();
    };
    const client = createImageClient({
      apiKey: 'k',
      model: 'm',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    const r = await client.generate('p');
    expect(Array.from(r.image)).toEqual(Array.from(PNG_BYTES));
    expect(calls).toBe(3);
  });

  it('throws bad-response when submit returns no images[]', async () => {
    const fetchImpl: typeof fetch = async (_url, init) => {
      if (init?.method === 'POST') return jsonOk({ images: [] });
      return pngOk();
    };
    const client = createImageClient({
      apiKey: 'k',
      model: 'm',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    try {
      await client.generate('p');
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(ImageApiError);
      expect((err as ImageApiError).error.kind).toBe('bad-response');
    }
  });

  it('translates AbortError into kind=aborted', async () => {
    const fetchImpl = vi.fn(async () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;
    const client = createImageClient({
      apiKey: 'k',
      model: 'm',
      fetch: fetchImpl,
      retry: FAST_RETRY,
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await client.generate('p', { signal: controller.signal });
      expect.fail();
    } catch (err) {
      expect(err).toBeInstanceOf(ImageApiError);
      expect((err as ImageApiError).error.kind).toBe('aborted');
    }
  });

  it('per-call model overrides the client default', async () => {
    let capturedUrl = '';
    const fetchImpl: typeof fetch = async (url, init) => {
      if (init?.method === 'POST') {
        capturedUrl = String(url);
        return jsonOk({ images: [{ url: 'https://cdn/x.png' }] });
      }
      return pngOk();
    };
    const client = createImageClient({
      apiKey: 'k',
      model: 'fal-ai/flux-schnell',
      fetch: fetchImpl,
    });
    await client.generate('p', { model: 'fal-ai/flux-pro/v1.1' });
    expect(capturedUrl).toContain('/fal-ai/flux-pro/v1.1');
  });
});
