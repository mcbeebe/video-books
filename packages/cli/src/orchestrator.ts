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
  /** Optional progress callback — called after each generated artifact. */
  onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { kind: 'image'; sceneN: number; cached: boolean }
  | { kind: 'video'; sceneN: number; cached: boolean; provider: string }
  | { kind: 'narration'; beatId: string; cached: boolean };

export interface Artifacts {
  imagePathFor(scene: Scene): string;
  clipPathFor(scene: Scene): string;
  audioPathFor(beat: Beat): string;
}

/**
 * Generate (or fetch from cache) every still, clip, and narration audio for a
 * chapter spec. Architecture §6.3-§6.5. Returns the artifact-path lookup
 * functions consumed by the assembler's `buildTimeline`.
 *
 * Concurrency is intentionally simple: scenes processed sequentially; within
 * a scene, image-gen → video-gen sequentially; narration is sequential
 * across all beats (architecture §6.5 — voice consistency).
 */
export async function generateArtifacts(
  spec: ChapterSpec,
  deps: OrchestratorDeps,
): Promise<Artifacts> {
  for (const scene of spec.scenes) {
    await ensureImage(scene, deps);
    await ensureVideo(scene, deps);
  }
  for (const scene of spec.scenes) {
    for (const beat of scene.beats) {
      await ensureNarration(beat, deps);
    }
  }
  return {
    imagePathFor: (s) => deps.cache.pathFor('images', imageKey(s, deps), 'png'),
    clipPathFor: (s) => deps.cache.pathFor('clips', clipKey(s, deps), 'mp4'),
    audioPathFor: (b) => deps.cache.pathFor('audio', narrationKey(b, deps), 'mp3'),
  };
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

async function ensureVideo(scene: Scene, deps: OrchestratorDeps): Promise<void> {
  const provider = deps.pickProvider(scene);
  const durationSec = sceneDurationSec(scene);
  const key = clipKey(scene, deps);
  if (await deps.cache.has('clips', key, 'mp4')) {
    deps.onProgress?.({ kind: 'video', sceneN: scene.n, cached: true, provider });
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
  deps.onProgress?.({ kind: 'video', sceneN: scene.n, cached: false, provider });
}

async function ensureNarration(beat: Beat, deps: OrchestratorDeps): Promise<void> {
  const key = narrationKey(beat, deps);
  if (await deps.cache.has('audio', key, 'mp3')) {
    deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: true });
    return;
  }
  const { audio } = await deps.narrationClient.generate(beat.text);
  await deps.cache.set('audio', key, 'mp3', audio);
  deps.onProgress?.({ kind: 'narration', beatId: beat.id, cached: false });
}

function imageKey(scene: Scene, deps: OrchestratorDeps): string {
  return deriveKey(scene.image, deps.styleAnchor, deps.imageProvider, deps.imageModel);
}

function clipKey(scene: Scene, deps: OrchestratorDeps): string {
  // durationSec is part of the key: same image + motion + provider with a
  // different requested length is a different clip (provider may render
  // differently and the output bytes will differ). Architecture §6.4
  // originally specified `(imageHash + motion + provider)` only — adding
  // duration is a deviation that keeps the cache content-addressable.
  return deriveKey(
    imageKey(scene, deps),
    scene.motion,
    deps.pickProvider(scene),
    sceneDurationSec(scene).toString(),
  );
}

/** Total clip duration for a scene = sum of its beat seconds. */
function sceneDurationSec(scene: Scene): number {
  return scene.beats.reduce((sum, b) => sum + b.sec, 0);
}

function narrationKey(beat: Beat, deps: OrchestratorDeps): string {
  return deriveKey(beat.text, deps.narrationVoiceId, deps.narrationModel);
}
