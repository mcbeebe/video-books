import type { VideoProviderConfig } from '../types.js';

/**
 * Kling Video v2.5 Turbo Pro (image-to-video). Switched 2026-05-02 (PR #28)
 * from v3/pro after fal.ai billing showed v3 was costing $0.14/sec — 2× our
 * preflight estimate of $0.07/sec. v2.5-turbo charges $0.35 for the first 5s
 * then $0.07/sec, ≈$0.07/sec flat. For the slow-drift sleep niche the v3 Pro
 * tier was overkill; turbo is visually indistinguishable on these scenes
 * and saves ~50% on every clip.
 *
 * Schema differences from v3/pro (verified live 2026-05-02 against
 * https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video):
 *
 * - Input field is `image_url` (NOT `start_image_url` like v3/pro).
 * - `duration` accepts ONLY "5" or "10" (NOT v3's 3-15 range). We quantize
 *   the requested duration UP to the nearest allowed value so audio is
 *   never truncated; this means a 7s scene pays for a 10s clip
 *   (~$0.70 instead of $0.49). Still cheaper than v3/pro at any duration.
 * - `maxDurationSec` is therefore 10 (used by orchestrator multi-clip
 *   splits — scenes with audio > 10s become N sub-clips).
 *
 * To switch back to v3/pro for cinematic scenes, restore `modelPath`,
 * change `image_url` → `start_image_url`, swap the duration quantizer back
 * to a 3-15 clamp, and bump `maxDurationSec` to 15. Cache keys are scoped
 * by provider *name* ('kling'), not modelPath — already-cached clips keep
 * getting served regardless of which Kling model we're calling for *new*
 * renders. Use a fresh `--cache-dir` (e.g. `cache-turbo/`) when
 * A/B-comparing model output.
 */
export const KLING: VideoProviderConfig = {
  name: 'kling',
  modelPath: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  defaultDurationSec: 5,
  maxDurationSec: 10,
  formatRequest: ({ imageUrl, prompt, durationSec }) => ({
    image_url: imageUrl,
    prompt,
    duration: quantizeKlingTurboDuration(durationSec),
  }),
};

/**
 * Quantize an arbitrary requested duration to one of v2.5-turbo's allowed
 * values ("5" or "10"). Always rounds UP so the clip never truncates
 * narration: ≤5s → "5", 6-10s → "10". Anything >10s should have been
 * split by the orchestrator's multi-clip planner before reaching here.
 */
function quantizeKlingTurboDuration(seconds: number): string {
  if (seconds <= 5) return '5';
  return '10';
}
