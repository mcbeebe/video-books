import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { deriveKey, type CacheStore } from '@video-books/cache';
import type { Beat, ChapterSpec, Scene } from '@video-books/types';

/**
 * Logger interface — `console`-compatible. Tests inject a buffer.
 */
export interface ManifestLogger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ManifestOptions {
  /** Show the FULL prompt (image + style anchor concatenated) instead of just `scene.image`. */
  full?: boolean;
  /** Cache root used by render. Defaults to `cache`. */
  cacheDir?: string;
  /** Identifier strings the orchestrator uses in cache keys. Must match what `wcap render` uses, or paths won't match. */
  imageProvider?: string;
  imageModel?: string;
  videoProvider?: 'kling' | 'seedance' | 'veo';
}

/**
 * Print a per-scene manifest of the chapter spec — which prompts go to which
 * APIs, which beats stack into which scenes, and which on-disk cache paths
 * hold the resulting artifacts.
 *
 * Useful for:
 * - reviewing prompts BEFORE spending money on a render
 * - mapping cached SHA256-named files back to scene numbers when editing
 *   in DaVinci / FinalCut
 * - debugging why a specific scene isn't hitting cache (different image
 *   text, different motion, different provider → different key)
 */
export async function printManifest(
  spec: ChapterSpec,
  styleAnchor: string,
  cache: CacheStore,
  logger: ManifestLogger,
  options: ManifestOptions = {},
): Promise<void> {
  const imageProvider = options.imageProvider ?? 'fal-ai/flux-pro';
  const imageModel = options.imageModel ?? 'v1.1';
  const videoProvider = options.videoProvider ?? 'kling';
  const showFull = options.full ?? false;

  logger.log(`# ${spec.slug} — ${spec.title}`);
  logger.log(`source: ${spec.source}`);
  logger.log(`styleAnchor: ${spec.styleAnchor}`);
  logger.log(
    `output: ${spec.output.width.toString()}×${spec.output.height.toString()} @ ${spec.output.fps.toString()}fps`,
  );
  logger.log('');

  let totalAuthoredSec = 0;
  for (const scene of spec.scenes) {
    const sceneAuthoredSec = scene.beats.reduce((s, b) => s + b.sec, 0);
    totalAuthoredSec += sceneAuthoredSec;
    logger.log(
      `## Scene ${scene.n.toString()} (${scene.type}) — ${scene.day}  [${sceneAuthoredSec.toString()}s authored]`,
    );

    const imageKey = deriveKey(scene.image, styleAnchor, imageProvider, imageModel);
    const imagePath = cache.pathFor('images', imageKey, 'png');
    logger.log(`  image:  ${showFull ? `${scene.image} ${styleAnchor}` : scene.image}`);
    logger.log(`          → ${imagePath}`);
    logger.log(`  motion: ${scene.motion}`);

    // Sub-clip paths: cache key is (imageKey + motion + provider + duration + index)
    // We don't know the actual measured duration without ffprobe, so we show the
    // authored sum — matches what `wcap render` would request if no probe is wired.
    // For the actual deployed paths, run after render and the cache hits will
    // confirm. Index 0 is shown by default; multi-clip scenes will have N entries.
    const clipKey = deriveKey(
      imageKey,
      scene.motion,
      videoProvider,
      sceneAuthoredSec.toFixed(2),
      '0',
    );
    const clipPath = cache.pathFor('clips', clipKey, 'mp4');
    logger.log(`  clip:   → ${clipPath}`);
    logger.log(
      `          (assumes ~${sceneAuthoredSec.toString()}s requested; actual paths vary if measured audio differs)`,
    );

    logger.log(`  beats:`);
    for (const beat of scene.beats) {
      const audioKey = deriveKey(beat.text, '<voiceId>', '<model>');
      const audioPathHint = cache.pathFor('audio', audioKey, 'mp3');
      logger.log(`    ${beat.id} (${beat.sec.toString()}s): ${beat.text}`);
      logger.log(`      → ${audioPathHint}  (varies by ELEVENLABS_VOICE_ID + model)`);
    }
    logger.log('');
  }
  logger.log(
    `Total: ${spec.scenes.length.toString()} scenes, ${totalAuthoredSec.toString()}s authored`,
  );
}

/**
 * Resolve the absolute path of a chapter's style anchor file. Tries the spec's
 * `styleAnchor` path verbatim first (relative to cwd), then falls back to a
 * path relative to the spec file's parent directory.
 */
export async function readStyleAnchor(specPath: string, styleAnchorRef: string): Promise<string> {
  try {
    return (await readFile(styleAnchorRef, 'utf8')).trim();
  } catch {
    const fallback = resolve(dirname(specPath), '..', styleAnchorRef.replace(/^content\//, ''));
    return (await readFile(join(fallback), 'utf8')).trim();
  }
}
