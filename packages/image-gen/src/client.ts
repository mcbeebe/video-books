import { retry } from '@video-books/http-utils';

/**
 * Provider configuration. The defaults target fal.ai's sync endpoint
 * (https://docs.fal.ai), the most-documented routing layer for hosted image
 * models. Architecture §3 calls out "Midjourney V7 API (or fal.ai routing)";
 * this package implements the latter because the official Midjourney v7
 * endpoint shape is uncertain — verify and add a sibling provider when ready.
 */
export interface ImageClientConfig {
  /** API key. For fal.ai: `Authorization: Key <key>`. */
  apiKey: string;
  /** Model path (fal.ai-style), e.g. `fal-ai/flux-pro/v1.1`. Override per-call too. */
  model: string;
  /** Style anchor appended to every prompt (architecture §6.3). */
  styleAnchor?: string;
  /** Override base URL — defaults to fal.run. */
  baseUrl?: string;
  /** Inject `fetch` for tests. */
  fetch?: typeof fetch;
  /** Retry config. */
  retry?: { maxAttempts?: number; baseMs?: number; capMs?: number };
  /** Default size (provider-specific). For fal-ai/flux: `landscape_16_9`, `square_hd`, etc. */
  imageSize?: string;
}

/** Per-call options. */
export interface ImageGenerateOptions {
  /** Override `imageSize` for this call. */
  imageSize?: string;
  /** Override `model` for this call (e.g. hero scenes routed to a higher-fidelity model). */
  model?: string;
  /** Optional negative prompt — supported by some models. */
  negativePrompt?: string;
  /** Optional seed for reproducibility. */
  seed?: number;
  signal?: AbortSignal;
}

export interface ImageResult {
  /** Raw bytes of the generated image. */
  image: Uint8Array;
  /** MIME type as reported by the provider; defaults to `image/png`. */
  contentType: string;
  /** Provider-reported request id (or null). */
  requestId: string | null;
  /** Width × height (pixels) — null if the provider didn't report. */
  width: number | null;
  height: number | null;
  /** URL the bytes were fetched from (debugging aid). */
  sourceUrl: string;
}

export type ImageError =
  | { kind: 'auth'; status: 401 | 403; message: string }
  | { kind: 'rate-limit'; status: 429; message: string; retryAfterMs: number | null }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'bad-response'; message: string }
  | { kind: 'network'; cause: unknown }
  | { kind: 'aborted' };

export class ImageApiError extends Error {
  readonly error: ImageError;

  constructor(error: ImageError) {
    super(formatError(error));
    this.name = 'ImageApiError';
    this.error = error;
  }
}

export interface ImageClient {
  generate(prompt: string, options?: ImageGenerateOptions): Promise<ImageResult>;
}

const DEFAULT_BASE_URL = 'https://fal.run';

interface FalImage {
  url: string;
  content_type?: string;
  width?: number;
  height?: number;
}

interface FalSubmitResponse {
  images: FalImage[];
  request_id?: string;
}

/**
 * Build an `ImageClient`. The implementation is fal.ai-shaped: POST a JSON
 * payload to `<baseUrl>/<model>` with `Authorization: Key <apiKey>`, parse
 * the response for an image URL, then GET the URL for raw bytes.
 *
 * @example
 *   const client = createImageClient({
 *     apiKey: process.env['FAL_KEY']!,
 *     model: 'fal-ai/flux-pro/v1.1',
 *     styleAnchor: await readFile('content/style-anchors/wilderness-v1.txt', 'utf8'),
 *   });
 *   const { image } = await client.generate('A high-altitude meadow at dawn');
 *   await fs.writeFile('scene-1.png', image);
 */
export function createImageClient(config: ImageClientConfig): ImageClient {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const retryConfig = config.retry ?? {};

  const generate = async (
    prompt: string,
    options: ImageGenerateOptions = {},
  ): Promise<ImageResult> => {
    if (prompt.length === 0) {
      throw new TypeError('image prompt must be non-empty');
    }
    const fullPrompt = config.styleAnchor ? `${prompt} ${config.styleAnchor}` : prompt;
    const model = options.model ?? config.model;
    const imageSize = options.imageSize ?? config.imageSize;

    type Outcome = { ok: true; result: ImageResult } | { ok: false; error: ImageError };

    const outcome = await retry<Outcome>(
      async () =>
        callOnce(fetchImpl, {
          baseUrl,
          model,
          apiKey: config.apiKey,
          prompt: fullPrompt,
          imageSize,
          negativePrompt: options.negativePrompt,
          seed: options.seed,
          signal: options.signal,
        }),
      (o) => {
        if (!o.ok) {
          if (isAbortError(o.cause)) {
            return { kind: 'keep', value: { ok: false, error: { kind: 'aborted' } } };
          }
          return { kind: 'retry', cause: o.cause };
        }
        if (o.value.ok) return { kind: 'keep', value: o.value };
        if (o.value.error.kind === 'rate-limit' || o.value.error.kind === 'server') {
          return { kind: 'retry', cause: o.value.error };
        }
        return { kind: 'keep', value: o.value };
      },
      retryConfig,
    ).catch((cause: unknown) => {
      const error: ImageError =
        cause && typeof cause === 'object' && 'kind' in cause
          ? (cause as ImageError)
          : { kind: 'network', cause };
      return { ok: false, error } satisfies Outcome;
    });

    if (!outcome.ok) throw new ImageApiError(outcome.error);
    return outcome.result;
  };

  return { generate };
}

interface CallParams {
  baseUrl: string;
  model: string;
  apiKey: string;
  prompt: string;
  imageSize: string | undefined;
  negativePrompt: string | undefined;
  seed: number | undefined;
  signal: AbortSignal | undefined;
}

async function callOnce(
  fetchImpl: typeof fetch,
  p: CallParams,
): Promise<{ ok: true; result: ImageResult } | { ok: false; error: ImageError }> {
  const submitUrl = `${p.baseUrl}/${p.model}`;
  const body: Record<string, unknown> = { prompt: p.prompt };
  if (p.imageSize !== undefined) body.image_size = p.imageSize;
  if (p.negativePrompt !== undefined) body.negative_prompt = p.negativePrompt;
  if (p.seed !== undefined) body.seed = p.seed;

  const submit = await fetchImpl(submitUrl, {
    method: 'POST',
    headers: {
      authorization: `Key ${p.apiKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
    ...(p.signal ? { signal: p.signal } : {}),
  });

  if (!submit.ok) return mapError(submit);

  let parsed: FalSubmitResponse;
  try {
    parsed = (await submit.json()) as FalSubmitResponse;
  } catch (cause) {
    return {
      ok: false,
      error: { kind: 'bad-response', message: `submit JSON parse failed: ${String(cause)}` },
    };
  }
  const first = parsed.images[0];
  if (!first || typeof first.url !== 'string') {
    return {
      ok: false,
      error: { kind: 'bad-response', message: 'submit response missing images[0].url' },
    };
  }

  const imageResp = await fetchImpl(first.url, {
    method: 'GET',
    ...(p.signal ? { signal: p.signal } : {}),
  });
  if (!imageResp.ok) return mapError(imageResp);

  const bytes = new Uint8Array(await imageResp.arrayBuffer());
  return {
    ok: true,
    result: {
      image: bytes,
      contentType: first.content_type ?? imageResp.headers.get('content-type') ?? 'image/png',
      requestId: parsed.request_id ?? submit.headers.get('x-request-id'),
      width: first.width ?? null,
      height: first.height ?? null,
      sourceUrl: first.url,
    },
  };
}

async function mapError(response: Response): Promise<{ ok: false; error: ImageError }> {
  const text = await safeReadText(response);
  if (response.status === 401 || response.status === 403) {
    return { ok: false, error: { kind: 'auth', status: response.status, message: text } };
  }
  if (response.status === 429) {
    return {
      ok: false,
      error: {
        kind: 'rate-limit',
        status: 429,
        message: text,
        retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
      },
    };
  }
  return { ok: false, error: { kind: 'server', status: response.status, message: text } };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

function formatError(e: ImageError): string {
  switch (e.kind) {
    case 'auth':
      return `image-gen auth failed (${e.status.toString()}): ${e.message}`;
    case 'rate-limit':
      return `image-gen rate-limited (${e.status.toString()}): ${e.message}`;
    case 'server':
      return `image-gen server error (${e.status.toString()}): ${e.message}`;
    case 'bad-response':
      return `image-gen bad response: ${e.message}`;
    case 'network':
      return `image-gen network error: ${String(e.cause)}`;
    case 'aborted':
      return 'image-gen aborted';
  }
}
