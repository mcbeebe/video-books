import { retry } from '@video-books/http-utils';

/** Voice tuning parameters per ElevenLabs `voice_settings`. */
export interface VoiceSettings {
  /** Lower = more variation, higher = more stable. ElevenLabs defaults around 0.5. */
  stability?: number;
  /** Closeness to the cloned voice. ElevenLabs defaults around 0.75. */
  similarityBoost?: number;
  /** Style exaggeration; voice-model dependent. */
  style?: number;
  useSpeakerBoost?: boolean;
}

/** Configuration for the narration client. */
export interface NarrationClientConfig {
  /** ElevenLabs API key. Read from `ELEVENLABS_API_KEY`. Never log. */
  apiKey: string;
  /** Voice ID to use for every call from this client instance. */
  voiceId: string;
  /** Model ID. Defaults to ElevenLabs' multilingual v2 — verify current best when integrating. */
  model?: string;
  /** Default voice settings; per-call options can override. */
  voiceSettings?: VoiceSettings;
  /** Override base URL — useful for tests or proxies. Defaults to api.elevenlabs.io. */
  baseUrl?: string;
  /** Inject `fetch` for tests; defaults to global. */
  fetch?: typeof fetch;
  /** Retry config — defaults are 5 attempts, exponential backoff capped at 8s. */
  retry?: { maxAttempts?: number; baseMs?: number; capMs?: number };
}

/** Per-call options. Anything omitted falls back to client defaults. */
export interface GenerateOptions {
  voiceSettings?: VoiceSettings;
  /** Aborts the in-flight request — propagates to the underlying fetch. */
  signal?: AbortSignal;
}

/** Successful narration: the audio bytes plus the HTTP `request-id` for log correlation. */
export interface NarrationResult {
  audio: Uint8Array;
  requestId: string | null;
  contentType: string;
}

/** Discriminated error for narration calls — see architecture §7. */
export type NarrationError =
  | { kind: 'auth'; status: 401 | 403; message: string }
  | { kind: 'rate-limit'; status: 429; message: string; retryAfterMs: number | null }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'network'; cause: unknown }
  | { kind: 'aborted' };

/** Thrown by `client.generate(...)` on any unsuccessful call. */
export class NarrationApiError extends Error {
  readonly error: NarrationError;

  constructor(error: NarrationError) {
    super(formatError(error));
    this.name = 'NarrationApiError';
    this.error = error;
  }
}

/**
 * Narration client wrapping the ElevenLabs text-to-speech endpoint.
 * Architecture §6.5: sequential, voice consistency requires a stable voiceId
 * and (recommended) ordered batching. Concurrency is the caller's responsibility —
 * use a queue if you call `generate` from multiple async paths simultaneously.
 *
 * @example
 *   const client = createNarrationClient({
 *     apiKey: process.env.ELEVENLABS_API_KEY!,
 *     voiceId: process.env.ELEVENLABS_VOICE_ID!,
 *   });
 *   const { audio } = await client.generate('A clear cold morning on the meadow.');
 *   await fs.writeFile('beat-1.mp3', audio);
 */
export interface NarrationClient {
  generate(text: string, options?: GenerateOptions): Promise<NarrationResult>;
}

const DEFAULT_BASE_URL = 'https://api.elevenlabs.io';
const DEFAULT_MODEL = 'eleven_multilingual_v2';

/** Factory: build a `NarrationClient`. */
export function createNarrationClient(config: NarrationClientConfig): NarrationClient {
  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const model = config.model ?? DEFAULT_MODEL;
  const retryConfig = config.retry ?? {};

  const generate = async (text: string, options?: GenerateOptions): Promise<NarrationResult> => {
    if (text.length === 0) {
      throw new TypeError('narration text must be non-empty');
    }
    const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}`;
    const body = JSON.stringify({
      text,
      model_id: model,
      voice_settings: toApiVoiceSettings(options?.voiceSettings ?? config.voiceSettings),
    });

    type Outcome = { ok: true; result: NarrationResult } | { ok: false; error: NarrationError };

    const outcome = await retry<Outcome>(
      async () => callOnce(fetchImpl, url, body, config.apiKey, options?.signal),
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
      // Retries exhausted — translate the last cause to a NarrationError.
      const error: NarrationError =
        cause && typeof cause === 'object' && 'kind' in cause
          ? (cause as NarrationError)
          : { kind: 'network', cause };
      return { ok: false, error } satisfies Outcome;
    });

    if (!outcome.ok) throw new NarrationApiError(outcome.error);
    return outcome.result;
  };

  return { generate };
}

async function callOnce(
  fetchImpl: typeof fetch,
  url: string,
  body: string,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<{ ok: true; result: NarrationResult } | { ok: false; error: NarrationError }> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'content-type': 'application/json',
      accept: 'audio/mpeg',
    },
    body,
    ...(signal ? { signal } : {}),
  });

  if (response.ok) {
    const audio = new Uint8Array(await response.arrayBuffer());
    return {
      ok: true,
      result: {
        audio,
        requestId: response.headers.get('request-id'),
        contentType: response.headers.get('content-type') ?? 'audio/mpeg',
      },
    };
  }

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

function toApiVoiceSettings(
  vs: VoiceSettings | undefined,
):
  | { stability?: number; similarity_boost?: number; style?: number; use_speaker_boost?: boolean }
  | undefined {
  if (!vs) return undefined;
  const out: {
    stability?: number;
    similarity_boost?: number;
    style?: number;
    use_speaker_boost?: boolean;
  } = {};
  if (vs.stability !== undefined) out.stability = vs.stability;
  if (vs.similarityBoost !== undefined) out.similarity_boost = vs.similarityBoost;
  if (vs.style !== undefined) out.style = vs.style;
  if (vs.useSpeakerBoost !== undefined) out.use_speaker_boost = vs.useSpeakerBoost;
  return out;
}

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError';
}

function formatError(e: NarrationError): string {
  switch (e.kind) {
    case 'auth':
      return `narration auth failed (${e.status.toString()}): ${e.message}`;
    case 'rate-limit':
      return `narration rate-limited (${e.status.toString()}): ${e.message}`;
    case 'server':
      return `narration server error (${e.status.toString()}): ${e.message}`;
    case 'network':
      return `narration network error: ${String(e.cause)}`;
    case 'aborted':
      return 'narration aborted';
  }
}
