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
   * Extra seconds added on top of measured scene-audio duration when sizing
   * each clip — usually set to the xfade overlap so video covers the entire
   * narration plus the fade tail. Combined with `Math.ceil`, this guarantees
   * `clip duration ≥ audio duration + xfade` so audio never truncates and
   * the fade-out happens *after* the narration ends.
   */
  clipPaddingSec?: number;
  /** Optional progress callback — called after each generated artifact. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: 'image'; sceneN: number; cached: boolean }
  | { kind: 'video'; sceneN: number; cached: boolean; provider: string; durationSec: number }
  | { kind: 'narration'; beatId: string; cached: boolean; durationSec: number };

export interface Artifacts {
  imagePathFor(scene: Scene): string;
  clipPathFor(scene: Scene): string;
  audioPathFor(beat: Beat): string;
  /** Measured (ffprobe) or fallback (authored `beat.sec`) duration for each beat. */
  audioDurationSecFor(beat: Beat): number;
  /** Measured-audio sum for the scene — what was passed to the video client as `durationSec`. */
  clipDurationSecFor(scene: Scene): number;
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
 *   Pass 2: per scene → image → video. Video duration is set to the sum of
 *           the scene's measured beat audio, not the authored sum, so the
 *           assembled MP4 has video continuously aligned with what is
 *           actually being said.
 *
 * Returned `Artifacts` exposes both path lookups and the measured durations
 * the assembler needs to build the filter graph.
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
  const clipDurations = new Map<number, number>();
  for (const scene of spec.scenes) {
    await ensureImage(scene, deps);
    const requestedSec = clipDurationFor(sumSceneAudio(scene, audioDurations), padding);
    clipDurations.set(scene.n, requestedSec);
    await ensureVideo(scene, requestedSec, deps);
  }

  return {
    imagePathFor: (s) => deps.cache.pathFor('images', imageKey(s, deps), 'png'),
    clipPathFor: (s) =>
      deps.cache.pathFor(
        'clips',
        clipKey(s, clipDurationFor(sumSceneAudio(s, audioDurations), padding), deps),
        'mp4',
      ),
    audioPathFor: (b) => deps.cache.pathFor('audio', narrationKey(b, deps), 'mp3'),
    audioDurationSecFor: (b) => audioDurations.get(b.id) ?? b.sec,
    clipDurationSecFor: (s) =>
      clipDurations.get(s.n) ?? clipDurationFor(sumSceneAudio(s, audioDurations), padding),
  };
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

async function ensureImage(scene: Scene, deps: OrchestratorDeps): Promise<void> {
  const key = imageKey(scene, deps);
  if (await deps.cache.has('images', key, 'png')) {
    deps.onProgress?.({ kind: 'image', sceneN: scene.n, cached: true });
    return;
  }
  const { image } = await deps.imageClient.generate(`${scene.image} ${deps.styleAnchor}`);
  await deps.cache.set('images', key, 'png', image);
  deps.onProgress?.({ kind: 'image', sceneN: scene.n, cached: false });
}

async function ensureVideo(
  scene: Scene,
  durationSec: number,
  deps: OrchestratorDeps,
): Promise<void> {
  const provider = deps.pickProvider(scene);
  const key = clipKey(scene, durationSec, deps);
  if (await deps.cache.has('clips', key, 'mp4')) {
    deps.onProgress?.({ kind: 'video', sceneN: scene.n, cached: true, provider, durationSec });
    return;
  }
  const image = await deps.cache.get('images', imageKey(scene, deps), 'png');
  if (image === null) throw new Error(`expected cached image for scene ${scene.n.toString()}`);
  const { video } = await deps.videoClient.generate({
    image,
    motion: scene.motion,
    provider,
    durationSec,
  });
  await deps.cache.set('clips', key, 'mp4', video);
  deps.onProgress?.({ kind: 'video', sceneN: scene.n, cached: false, provider, durationSec });
}

async function ensureNarration(beat: Beat, deps: OrchestratorDeps): Promise<void> {
  const key = narrationKey(beat, deps);
  if (await deps.cache.has('audio', key, 'mp3')) {
    deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: true, durationSec: beat.sec });
    return;
  }
  const { audio } = await deps.narrationClient.generate(beat.text);
  await deps.cache.set('audio', key, 'mp3', audio);
  deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: false, durationSec: beat.sec });
}

function imageKey(scene: Scene, deps: OrchestratorDeps): string {
  return deriveKey(scene.image, deps.styleAnchor, deps.imageProvider, deps.imageModel);
}

function clipKey(scene: Scene, durationSec: number, deps: OrchestratorDeps): string {
  // durationSec (rounded) is part of the key: same image+motion+provider with
  // a different requested length is a different clip.
  return deriveKey(
    imageKey(scene, deps),
    scene.motion,
    deps.pickProvider(scene),
    durationSec.toFixed(2),
  );
}

function narrationKey(beat: Beat, deps: OrchestratorDeps): string {
  return deriveKey(beat.text, deps.narrationVoiceId, deps.narrationModel);
}

function sumSceneAudio(scene: Scene, audioDurations: Map<string, number>): number {
  return scene.beats.reduce((sum, b) => sum + (audioDurations.get(b.id) ?? b.sec), 0);
}
