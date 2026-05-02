import { deriveKey, type CacheStore } from '@video-books/cache';
import type { Beat, ChapterSpec, Scene } from '@video-books/types';

/** Minimal interface a video-gen client must satisfy for the orchestrator. */
export interface VideoGenerator {
  generate(input: {
    image: Uint8Array;
    motion: string;
    provider?: 'kling' | 'seedance' | 'veo';
    /** Requested clip length in seconds (provider may coerce/clamp). */
    durationSec?: number;
  }): Promise<{ video: Uint8Array }>;
}

/** Minimal interface an image-gen client must satisfy. */
export interface ImageGenerator {
  generate(prompt: string): Promise<{ image: Uint8Array }>;
}

/** Minimal interface a narration client must satisfy. */
export interface NarrationGenerator {
  generate(text: string): Promise<{ audio: Uint8Array }>;
}

/** Picks the video provider for a scene (default: kling for everything — see `pickProvider` in @video-books/video-gen). */
export type ProviderRouter = (scene: Pick<Scene, 'type'>) => 'kling' | 'seedance' | 'veo';

/** Per-provider max clip length so the orchestrator can split long scenes. */
export type ProviderMaxDurationLookup = (provider: 'kling' | 'seedance' | 'veo') => number;

/** External dependencies — fully injected so the orchestrator is unit-testable. */
export interface OrchestratorDeps {
  cache: CacheStore;
  imageClient: ImageGenerator;
  videoClient: VideoGenerator;
  narrationClient: NarrationGenerator;
  pickProvider: ProviderRouter;
  /** Style anchor string, appended to image prompts and included in the cache key. */
  styleAnchor: string;
  /** Provider+model identifier strings included in cache keys (architecture §6.3). */
  imageProvider: string;
  imageModel: string;
  narrationVoiceId: string;
  narrationModel: string;
  /**
   * Probe a cached audio file for its actual duration in seconds. Used by the
   * two-pass orchestrator to size video clips to *measured* audio length
   * (ElevenLabs reads faster than authored `beat.sec` estimates). When omitted
   * the orchestrator falls back to authored `beat.sec` — useful for tests
   * that don't ship ffprobe.
   */
  probeAudioDurationSec?: (path: string) => Promise<number>;
  /**
   * Extract the very last frame of a cached clip as PNG bytes. Required for
   * multi-clip-per-scene chaining: when a scene needs N>1 clips because its
   * audio exceeds the provider's max clip length, the last frame of clip K
   * becomes the start image of clip K+1 so the visual flows continuously
   * instead of restarting from the scene's still each sub-clip.
   *
   * If omitted, scenes that exceed `providerMaxDurationSec` will use the
   * scene's still as the start image for every sub-clip (acceptable in
   * tests; visually a soft "continuation" feel in production).
   */
  extractLastFrame?: (clipPath: string) => Promise<Uint8Array>;
  /**
   * Per-provider max clip length in seconds. Used to decide when to split a
   * scene into multiple sub-clips. Required when `extractLastFrame` is set.
   */
  providerMaxDurationSec?: ProviderMaxDurationLookup;
  /**
   * Extra seconds added on top of measured scene-audio duration when sizing
   * each clip — usually set to the xfade overlap so video covers the entire
   * narration plus the fade tail. Combined with `Math.ceil`, this guarantees
   * `clip duration ≥ audio duration + xfade` so audio never truncates and
   * the fade-out happens *after* the narration ends.
   */
  clipPaddingSec?: number;
  /**
   * Emit a `heartbeat` ProgressEvent once an external API call has been
   * running this long, then every `heartbeatIntervalMs` after. Defaults to
   * 15s threshold + 30s interval — quiet for fast image / narration calls,
   * useful for the multi-minute kling video calls. Set `heartbeatAfterMs: 0`
   * to disable.
   */
  heartbeatAfterMs?: number;
  /** See `heartbeatAfterMs`. Defaults to 30000 (30 seconds). */
  heartbeatIntervalMs?: number;
  /** Optional progress callback — called after each generated artifact. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: 'image'; sceneN: number; cached: boolean }
  | {
      kind: 'video';
      sceneN: number;
      cached: boolean;
      provider: string;
      durationSec: number;
      /** Index within scene (0-based). For single-clip scenes always 0. */
      subclipIndex: number;
      /** Total sub-clips for this scene. For single-clip scenes always 1. */
      subclipCount: number;
    }
  | { kind: 'narration'; beatId: string; cached: boolean; durationSec: number }
  | {
      /**
       * Periodic "still working" tick during a long external API call.
       * Emitted only after the call has been running for at least
       * `heartbeatAfterMs` (so short calls stay quiet). Useful for surfacing
       * progress during the multi-minute kling waits without spamming during
       * the fast image / narration calls.
       */
      kind: 'heartbeat';
      label: string;
      elapsedSec: number;
    };

export interface Artifacts {
  imagePathFor(scene: Scene): string;
  /**
   * Returns one or more cached clip paths for the scene, in playback order.
   * Single-clip scenes return `[onePath]`; long scenes return one path per
   * sub-clip. The filter graph concats sub-clips with no fade in between
   * (sub-clips of the same scene are visually continuous via last-frame
   * chaining), and crossfades only between scenes.
   */
  clipPathsFor(scene: Scene): string[];
  audioPathFor(beat: Beat): string;
  /** Measured (ffprobe) or fallback (authored `beat.sec`) duration for each beat. */
  audioDurationSecFor(beat: Beat): number;
  /**
   * Per-sub-clip durations for the scene, in playback order. Sum of these
   * equals the scene's requested clip duration. For single-clip scenes,
   * returns a single-element array.
   */
  clipDurationsSecFor(scene: Scene): number[];
}

/**
 * Generate (or fetch from cache) every still, clip, and narration audio for a
 * chapter spec. Architecture §6.3-§6.5.
 *
 * Two-pass design (architecture deviation worth flagging):
 *
 *   Pass 1: narration first, sequential per voice (architecture §6.5). After
 *           each beat we probe the cached MP3 to learn its *actual* duration —
 *           ElevenLabs reads at its own pace, not the authored `beat.sec`.
 *   Pass 2: per scene → image → video clips. Video duration is set to the
 *           sum of the scene's measured beat audio, not the authored sum,
 *           so the assembled MP4 has video continuously aligned with what
 *           is actually being said. Scenes whose total exceeds the routed
 *           provider's max clip length are split into N sub-clips that
 *           chain via last-frame extraction.
 */
export async function generateArtifacts(
  spec: ChapterSpec,
  deps: OrchestratorDeps,
): Promise<Artifacts> {
  const audioDurations = new Map<string, number>();

  for (const scene of spec.scenes) {
    for (const beat of scene.beats) {
      await ensureNarration(beat, deps);
      const path = deps.cache.pathFor('audio', narrationKey(beat, deps), 'mp3');
      const measured = deps.probeAudioDurationSec
        ? await deps.probeAudioDurationSec(path)
        : beat.sec;
      audioDurations.set(beat.id, measured);
    }
  }

  const padding = deps.clipPaddingSec ?? 0;
  const subclipDurations = new Map<number, number[]>();
  const subclipPaths = new Map<number, string[]>();

  for (const scene of spec.scenes) {
    await ensureImage(scene, deps);
    const sceneAudioSec = sumSceneAudio(scene, audioDurations);
    const requestedSec = clipDurationFor(sceneAudioSec, padding);
    const splits = planSubclips(scene, requestedSec, deps);
    subclipDurations.set(scene.n, splits);
    const paths = await ensureVideoClips(scene, splits, deps);
    subclipPaths.set(scene.n, paths);
  }

  return {
    imagePathFor: (s) => deps.cache.pathFor('images', imageKey(s, deps), 'png'),
    clipPathsFor: (s) =>
      subclipPaths.get(s.n) ?? [
        deps.cache.pathFor(
          'clips',
          clipKey(s, clipDurationFor(sumSceneAudio(s, audioDurations), padding), 0, deps),
          'mp4',
        ),
      ],
    audioPathFor: (b) => deps.cache.pathFor('audio', narrationKey(b, deps), 'mp3'),
    audioDurationSecFor: (b) => audioDurations.get(b.id) ?? b.sec,
    clipDurationsSecFor: (s) =>
      subclipDurations.get(s.n) ?? [clipDurationFor(sumSceneAudio(s, audioDurations), padding)],
  };
}

/**
 * Plan the per-sub-clip durations for a scene. If the requested duration
 * fits in a single clip (≤ provider max), returns `[requestedSec]`.
 * Otherwise splits into N near-equal sub-clips, each ≤ provider max, that
 * sum to `requestedSec`.
 */
function planSubclips(scene: Scene, requestedSec: number, deps: OrchestratorDeps): number[] {
  const provider = deps.pickProvider(scene);
  const maxSec = deps.providerMaxDurationSec?.(provider) ?? Infinity;
  if (requestedSec <= maxSec) return [requestedSec];

  const count = Math.ceil(requestedSec / maxSec);
  const evenSplit = Math.ceil(requestedSec / count);
  const splits: number[] = [];
  let remaining = requestedSec;
  for (let i = 0; i < count - 1; i += 1) {
    const dur = Math.min(evenSplit, maxSec);
    splits.push(dur);
    remaining -= dur;
  }
  splits.push(Math.min(Math.max(1, remaining), maxSec));
  return splits;
}

async function ensureImage(scene: Scene, deps: OrchestratorDeps): Promise<void> {
  const key = imageKey(scene, deps);
  if (await deps.cache.has('images', key, 'png')) {
    deps.onProgress?.({ kind: 'image', sceneN: scene.n, cached: true });
    return;
  }
  const { image } = await withHeartbeat(`image scene ${scene.n.toString()}`, deps, () =>
    deps.imageClient.generate(`${scene.image} ${deps.styleAnchor}`),
  );
  await deps.cache.set('images', key, 'png', image);
  deps.onProgress?.({ kind: 'image', sceneN: scene.n, cached: false });
}

/**
 * Generate (or fetch from cache) the sub-clips for a scene. The first sub-clip
 * uses the scene's still image; subsequent sub-clips use the last frame of
 * the previous sub-clip (extracted via ffmpeg) so the visual continues
 * smoothly. Falls back to the scene still for every sub-clip if
 * `extractLastFrame` isn't injected (test environments).
 */
async function ensureVideoClips(
  scene: Scene,
  subclipSecs: number[],
  deps: OrchestratorDeps,
): Promise<string[]> {
  const provider = deps.pickProvider(scene);
  const subclipCount = subclipSecs.length;
  const paths: string[] = [];

  for (let i = 0; i < subclipCount; i += 1) {
    const durationSec = subclipSecs[i] ?? 0;
    const key = clipKey(scene, durationSec, i, deps);
    const path = deps.cache.pathFor('clips', key, 'mp4');

    if (await deps.cache.has('clips', key, 'mp4')) {
      paths.push(path);
      deps.onProgress?.({
        kind: 'video',
        sceneN: scene.n,
        cached: true,
        provider,
        durationSec,
        subclipIndex: i,
        subclipCount,
      });
      continue;
    }

    let inputImage: Uint8Array;
    if (i === 0) {
      const stillImage = await deps.cache.get('images', imageKey(scene, deps), 'png');
      if (stillImage === null) {
        throw new Error(`expected cached image for scene ${scene.n.toString()}`);
      }
      inputImage = stillImage;
    } else if (deps.extractLastFrame) {
      const prevPath = paths[i - 1];
      if (prevPath === undefined) throw new Error('expected previous sub-clip path');
      inputImage = await deps.extractLastFrame(prevPath);
    } else {
      // No frame extraction available — reuse the scene still. Sub-clips will
      // look like soft "restarts" of the same shot. Acceptable for tests;
      // production should always inject extractLastFrame.
      const stillImage = await deps.cache.get('images', imageKey(scene, deps), 'png');
      if (stillImage === null) {
        throw new Error(`expected cached image for scene ${scene.n.toString()}`);
      }
      inputImage = stillImage;
    }

    const label =
      subclipCount > 1
        ? `video scene ${scene.n.toString()}/${(i + 1).toString()}-of-${subclipCount.toString()} / ${provider}`
        : `video scene ${scene.n.toString()} / ${provider}`;
    const { video } = await withHeartbeat(label, deps, () =>
      deps.videoClient.generate({
        image: inputImage,
        motion: scene.motion,
        provider,
        durationSec,
      }),
    );
    await deps.cache.set('clips', key, 'mp4', video);
    paths.push(path);
    deps.onProgress?.({
      kind: 'video',
      sceneN: scene.n,
      cached: false,
      provider,
      durationSec,
      subclipIndex: i,
      subclipCount,
    });
  }

  return paths;
}

async function ensureNarration(beat: Beat, deps: OrchestratorDeps): Promise<void> {
  const key = narrationKey(beat, deps);
  if (await deps.cache.has('audio', key, 'mp3')) {
    deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: true, durationSec: beat.sec });
    return;
  }
  const { audio } = await withHeartbeat(`narration ${beat.id}`, deps, () =>
    deps.narrationClient.generate(beat.text),
  );
  await deps.cache.set('audio', key, 'mp3', audio);
  deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: false, durationSec: beat.sec });
}

function imageKey(scene: Scene, deps: OrchestratorDeps): string {
  return deriveKey(scene.image, deps.styleAnchor, deps.imageProvider, deps.imageModel);
}

/**
 * Cache key for sub-clip `index` of `scene` at `durationSec`. The sub-clip
 * index participates in the key so each sub-clip gets a unique cached file
 * even when image+motion+provider+duration match — chained sub-clips have
 * different actual input frames but the same key inputs from the spec's
 * point of view.
 */
function clipKey(scene: Scene, durationSec: number, index: number, deps: OrchestratorDeps): string {
  return deriveKey(
    imageKey(scene, deps),
    scene.motion,
    deps.pickProvider(scene),
    durationSec.toFixed(2),
    index.toString(),
  );
}

function narrationKey(beat: Beat, deps: OrchestratorDeps): string {
  return deriveKey(beat.text, deps.narrationVoiceId, deps.narrationModel);
}

function sumSceneAudio(scene: Scene, audioDurations: Map<string, number>): number {
  return scene.beats.reduce((sum, b) => sum + (audioDurations.get(b.id) ?? b.sec), 0);
}

/**
 * Compute the clip-duration we ask the provider for, given measured audio
 * length and an xfade-padding allowance. Always rounded UP so the clip is at
 * least as long as `audio + padding` — guarantees no audio truncation and
 * leaves room for a fade-out that doesn't overlap the narration.
 */
function clipDurationFor(audioSec: number, paddingSec: number): number {
  return Math.max(1, Math.ceil(audioSec + paddingSec));
}

/**
 * Run an async operation; if it's still pending after `heartbeatAfterMs`,
 * start emitting `heartbeat` ProgressEvents every `heartbeatIntervalMs`
 * until it resolves. Quiet for fast calls (image, narration); informative
 * for the multi-minute kling video calls.
 */
async function withHeartbeat<T>(
  label: string,
  deps: OrchestratorDeps,
  fn: () => Promise<T>,
): Promise<T> {
  const after = deps.heartbeatAfterMs ?? 15000;
  const interval = deps.heartbeatIntervalMs ?? 30000;
  if (after <= 0 || !deps.onProgress) {
    return fn();
  }
  const start = Date.now();
  let intervalHandle: NodeJS.Timeout | undefined;
  const startHandle: NodeJS.Timeout = setTimeout(() => {
    deps.onProgress?.({
      kind: 'heartbeat',
      label,
      elapsedSec: Math.round((Date.now() - start) / 1000),
    });
    intervalHandle = setInterval(() => {
      deps.onProgress?.({
        kind: 'heartbeat',
        label,
        elapsedSec: Math.round((Date.now() - start) / 1000),
      });
    }, interval);
  }, after);
  try {
    return await fn();
  } finally {
    clearTimeout(startHandle);
    if (intervalHandle !== undefined) clearInterval(intervalHandle);
  }
}
