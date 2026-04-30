import { retry } from '@video-books/http-utils';
import { KLING } from './providers/kling.js';
import { SEEDANCE } from './providers/seedance.js';
import { VEO } from './providers/veo.js';
import {
  VideoApiError,
  type VideoClient,
  type VideoError,
  type VideoGenerateInput,
  type VideoProviderConfig,
  type VideoProviderName,
  type VideoResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://fal.run';

const PROVIDERS: Record<VideoProviderName, VideoProviderConfig> = {
  kling: KLING,
  seedance: SEEDANCE,
  veo: VEO,
};

export interface VideoClientConfig {
  /** API key. fal.ai expects `Authorization: Key <key>`. */
  apiKey: string;
  /** Default provider when input doesn't specify one. */
  defaultProvider: VideoProviderName;
  /** Override base URL — useful for tests / proxies. Defaults to fal.run. */
  baseUrl?: string;
  /** Override or extend providers. Useful when iterating model-path slugs. */
  providers?: Partial<Record<VideoProviderName, VideoProviderConfig>>;
  /** Inject `fetch` for tests. */
  fetch?: typeof fetch;
  /** Retry config. */
  retry?: { maxAttempts?: number; baseMs?: number; capMs?: number };
}

/**
 * Build a `VideoClient` that posts to fal.ai's sync endpoint and downloads
 * the resulting video. Architecture §6.4. Provider-per-call is determined
 * by `input.provider` ?? `defaultProvider`; combine with `pickProvider(scene)`
 * from the router for HERO/SCENE-aware selection.
 *
 * Note: fal sync endpoints work for video clips up to ~10s. For longer
 * clips you'll want to swap to the queue API (POST → poll → GET) — out of
 * scope for the pilot.
 *
 * @example
 *   const client = createVideoClient({ apiKey: process.env['FAL_KEY']!, defaultProvider: 'kling' });
 *   const { video } = await client.generate({
 *     image: 'https://cdn/scene-1.png',
 *     motion: scene.motion,
 *     provider: pickProvider(scene),
 *   });
 *   await fs.writeFile('clip-1.mp4', video);
 */
export function createVideoClient(config: VideoClientConfig): VideoClient {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const retryConfig = config.retry ?? {};
  const providers: Record<VideoProviderName, VideoProviderConfig> = {
    ...PROVIDERS,
    ...config.providers,
  };

  const generate = async (input: VideoGenerateInput): Promise<VideoResult> => {
    if (input.motion.length === 0) {
      throw new TypeError('motion direction must be non-empty');
    }
    const providerName = input.provider ?? config.defaultProvider;
    const provider = providers[providerName];
    const durationSec = input.durationSec ?? provider.defaultDurationSec;
    const imageUrl = asImageUrl(input.image);

    type Outcome = { ok: true; result: VideoResult } | { ok: false; error: VideoError };

    const outcome = await retry<Outcome>(
      async () =>
        callOnce(fetchImpl, {
          baseUrl,
          provider,
          apiKey: config.apiKey,
          imageUrl,
          motion: input.motion,
          durationSec,
          signal: input.signal,
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
      const error: VideoError =
        cause && typeof cause === 'object' && 'kind' in cause
          ? (cause as VideoError)
          : { kind: 'network', cause };
      return { ok: false, error } satisfies Outcome;
    });

    if (!outcome.ok) throw new VideoApiError(outcome.error);
    return outcome.result;
  };

  return { generate };
}

interface CallParams {
  baseUrl: string;
  provider: VideoProviderConfig;
  apiKey: string;
  imageUrl: string;
  motion: string;
  durationSec: number;
  signal: AbortSignal | undefined;
}

interface FalVideoSubmitResponse {
  video?: { url?: string; content_type?: string; duration?: number };
  videos?: { url?: string; content_type?: string; duration?: number }[];
  request_id?: string;
}

async function callOnce(
  fetchImpl: typeof fetch,
  p: CallParams,
): Promise<{ ok: true; result: VideoResult } | { ok: false; error: VideoError }> {
  const submitUrl = `${p.baseUrl}/${p.provider.modelPath}`;
  const formatted = p.provider.formatRequest
    ? p.provider.formatRequest({
        imageUrl: p.imageUrl,
        prompt: p.motion,
        durationSec: p.durationSec,
      })
    : { image_url: p.imageUrl, prompt: p.motion, duration: p.durationSec };
  const body: Record<string, unknown> = { ...formatted, ...p.provider.bodyExtras };

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

  let parsed: FalVideoSubmitResponse;
  try {
    parsed = (await submit.json()) as FalVideoSubmitResponse;
  } catch (cause) {
    return {
      ok: false,
      error: { kind: 'bad-response', message: `submit JSON parse failed: ${String(cause)}` },
    };
  }
  const extracted = p.provider.parseSubmitResponse?.(parsed) ?? defaultParse(parsed);
  if (!extracted) {
    return {
      ok: false,
      error: { kind: 'bad-response', message: 'submit response missing video.url' },
    };
  }

  const videoResp = await fetchImpl(extracted.url, {
    method: 'GET',
    ...(p.signal ? { signal: p.signal } : {}),
  });
  if (!videoResp.ok) return mapError(videoResp);

  const bytes = new Uint8Array(await videoResp.arrayBuffer());
  return {
    ok: true,
    result: {
      video: bytes,
      contentType: extracted.contentType ?? videoResp.headers.get('content-type') ?? 'video/mp4',
      requestId: parsed.request_id ?? submit.headers.get('x-request-id'),
      durationSec: parsed.video?.duration ?? parsed.videos?.[0]?.duration ?? null,
      sourceUrl: extracted.url,
      provider: p.provider.name,
    },
  };
}

function defaultParse(json: FalVideoSubmitResponse): { url: string; contentType?: string } | null {
  if (json.video?.url) {
    return {
      url: json.video.url,
      ...(json.video.content_type !== undefined ? { contentType: json.video.content_type } : {}),
    };
  }
  const first = json.videos?.[0];
  if (first?.url) {
    return {
      url: first.url,
      ...(first.content_type !== undefined ? { contentType: first.content_type } : {}),
    };
  }
  return null;
}

function asImageUrl(image: string | Uint8Array): string {
  if (typeof image === 'string') return image;
  const base64 = Buffer.from(image).toString('base64');
  return `data:image/png;base64,${base64}`;
}

async function mapError(response: Response): Promise<{ ok: false; error: VideoError }> {
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
