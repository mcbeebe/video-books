/** Discriminated error union for video-gen calls. Mirrors image-gen / narration. */
export type VideoError =
  | { kind: 'auth'; status: 401 | 403; message: string }
  | { kind: 'rate-limit'; status: 429; message: string; retryAfterMs: number | null }
  | { kind: 'server'; status: number; message: string }
  | { kind: 'timeout'; message: string }
  | { kind: 'bad-response'; message: string }
  | { kind: 'network'; cause: unknown }
  | { kind: 'aborted' };

export class VideoApiError extends Error {
  readonly error: VideoError;

  constructor(error: VideoError) {
    super(formatError(error));
    this.name = 'VideoApiError';
    this.error = error;
  }
}

/** Result of a successful video generation. */
export interface VideoResult {
  /** Raw bytes of the generated video (typically MP4). */
  video: Uint8Array;
  contentType: string;
  /** Provider-reported request id for log correlation. */
  requestId: string | null;
  /** Duration in seconds, if reported. */
  durationSec: number | null;
  /** URL the bytes were fetched from (debugging). */
  sourceUrl: string;
  /** Which provider serviced the call. */
  provider: VideoProviderName;
}

/** Generation request inputs. */
export interface VideoGenerateInput {
  /**
   * Either an HTTPS URL the provider can fetch, OR raw bytes that the client
   * will encode as a data URL. Architecture §6.4: input is the base image
   * produced by image-gen plus a motion direction string.
   */
  image: string | Uint8Array;
  /** Motion direction text (architecture §6.4 — the per-scene `motion` field). */
  motion: string;
  /** Override default provider. The router picks a provider per-scene; pass `provider` to override that choice. */
  provider?: VideoProviderName;
  /** Optional clip duration override (seconds). Defaults to provider-specific (typically 5). */
  durationSec?: number;
  signal?: AbortSignal;
}

/** Names of the providers shipped with this package. Add more by extending the registry. */
export type VideoProviderName = 'kling' | 'seedance' | 'veo';

/** Inputs the client passes to the provider's request formatter. */
export interface VideoFormatRequestInput {
  imageUrl: string;
  prompt: string;
  durationSec: number;
}

/** Static metadata + endpoint config for one provider. */
export interface VideoProviderConfig {
  /** Display name used in cache keys + logs. */
  name: VideoProviderName;
  /** Provider model path appended to baseUrl (fal.ai-style). */
  modelPath: string;
  /** Default clip duration (seconds). The provider's formatRequest may coerce. */
  defaultDurationSec: number;
  /**
   * Translate the orchestrator's neutral request shape into the body fields
   * the provider's API actually expects. fal.ai providers diverge on field
   * names (Kling wants `start_image_url`, others want `image_url`) and on
   * duration encoding (Veo wants `"6s"`, Kling/Seedance want `"6"`).
   *
   * Defaults to `{ image_url, prompt, duration: durationSec }` if omitted.
   */
  formatRequest?: (input: VideoFormatRequestInput) => Record<string, unknown>;
  /** Provider-specific extra body params (constant per provider). */
  bodyExtras?: Record<string, unknown>;
  /**
   * Provider-specific response key extraction. Default looks for
   * `video.url` and `video.content_type`.
   */
  parseSubmitResponse?: (json: unknown) => { url: string; contentType?: string } | null;
}

export interface VideoClient {
  generate(input: VideoGenerateInput): Promise<VideoResult>;
}

function formatError(e: VideoError): string {
  switch (e.kind) {
    case 'auth':
      return `video-gen auth failed (${e.status.toString()}): ${e.message}`;
    case 'rate-limit':
      return `video-gen rate-limited (${e.status.toString()}): ${e.message}`;
    case 'server':
      return `video-gen server error (${e.status.toString()}): ${e.message}`;
    case 'timeout':
      return `video-gen timeout: ${e.message}`;
    case 'bad-response':
      return `video-gen bad response: ${e.message}`;
    case 'network':
      return `video-gen network error: ${String(e.cause)}`;
    case 'aborted':
      return 'video-gen aborted';
  }
}
