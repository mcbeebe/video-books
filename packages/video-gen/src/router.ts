import type { Scene } from '@video-books/types';
import type { VideoProviderName } from './types.js';

/**
 * Route every scene to Kling v3 Pro.
 *
 * Why kling-only (decided 2026-04-30 after smoke comparison):
 *
 * - **Most cinematic motion** for the YouTube sleep / soundscape niche
 *   (Get Sleepy, Nothing Much Happens). Kling reads motion prompts more
 *   literally than Veo and produces slower, more deliberate camera moves.
 * - **Avoids Veo's cross-fade trap**: Veo tends to interpret two-subject
 *   motion prompts ("tilt from sky to lake") as a transition between two
 *   shots rather than a continuous camera move — disastrous for sleep
 *   content where you want unbroken motion.
 * - **Cost still fits**: ~$0.07/sec × 5s × 137 scenes ≈ $48 for the full
 *   Chapter 6 — well inside the $500 pilot budget.
 * - **Trade-off**: ~2× slower wall-clock than Veo. Architecture §2 already
 *   says "can run on a workstation overnight" so this is acceptable.
 *
 * To override per-scene, pass `provider` on the orchestrator's
 * `VideoGenerateInput` (e.g. fall back to Veo when a particular scene
 * needs a different look).
 *
 * @example
 *   // Always kling under the default router:
 *   const provider = pickProvider(scene); // 'kling'
 *   // Per-scene override at the call site:
 *   await videoClient.generate({ image, motion, provider: 'veo' });
 */
export function pickProvider(_scene: Pick<Scene, 'type'>): VideoProviderName {
  return 'kling';
}
