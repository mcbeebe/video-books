import type { VideoProviderConfig } from '../types.js';

/**
 * Kling Video v2.5 Turbo Pro (image-to-video). Switched 2026-05-02 (PR #28)
 * from v3/pro after fal.ai billing showed v3 was costing $0.14/sec — 2× our
 * preflight estimate of $0.07/sec. v2.5-turbo charges $0.35 for the first 5s
 * then $0.07/sec, ≈$0.07/sec flat. For the slow-drift sleep niche the v3 Pro
 * tier was overkill; turbo is visually indistinguishable on these scenes
 * and saves ~50% on every clip.
 *
 * Schema parity: same `start_image_url` quirk and stringified `duration`
 * "3"-"15", default "5". Verified against
 * https://fal.ai/models/fal-ai/kling-video/v2.5-turbo/pro/image-to-video.
 *
 * To switch back to v3/pro for cinematic scenes, change `modelPath` below.
 * Cache keys are scoped by provider *name* ('kling'), not modelPath — so
 * already-cached clips keep getting served regardless of which Kling model
 * we're calling for *new* renders. Use a fresh `--cache-dir` (e.g.
 * `cache-turbo/`) when A/B-comparing model output.
 */
export const KLING: VideoProviderConfig = {
  name: 'kling',
  modelPath: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
  defaultDurationSec: 5,
  maxDurationSec: 15,
  formatRequest: ({ imageUrl, prompt, durationSec }) => ({
    start_image_url: imageUrl,
    prompt,
    duration: clampInt(durationSec, 3, 15).toString(),
  }),
};

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
