import type { VideoProviderConfig } from '../types.js';

/**
 * Seedance 2.0 Fast (image-to-video). Architecture §3 cost-tier alternate.
 * Path + schema verified live on 2026-04-29 against
 * https://fal.ai/models/bytedance/seedance-2.0/fast/image-to-video.
 *
 * Notable: published under the `bytedance/` namespace (no `fal-ai/` prefix);
 * fal hosts ByteDance models under the publisher org. Duration is a
 * stringified integer "4" through "15" (no `s` suffix).
 *
 * For higher quality drop the `/fast/`: `bytedance/seedance-2.0/image-to-video`.
 */
export const SEEDANCE: VideoProviderConfig = {
  name: 'seedance',
  modelPath: 'bytedance/seedance-2.0/fast/image-to-video',
  defaultDurationSec: 5,
  formatRequest: ({ imageUrl, prompt, durationSec }) => ({
    image_url: imageUrl,
    prompt,
    duration: clampInt(durationSec, 4, 15).toString(),
  }),
};

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
