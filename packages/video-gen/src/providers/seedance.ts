import type { VideoProviderConfig } from '../types.js';

/**
 * Seedance 2.0 Fast (image-to-video). Architecture §3 cost-tier alternate.
 * Path verified against https://fal.ai/models?keywords=seedance on
 * 2026-04-29 — note the `bytedance/` namespace (no `fal-ai/` prefix);
 * fal hosts ByteDance's models under the publisher's org slug.
 *
 * For higher quality use `bytedance/seedance-2.0/image-to-video` (drop
 * `/fast/`).
 */
export const SEEDANCE: VideoProviderConfig = {
  name: 'seedance',
  modelPath: 'bytedance/seedance-2.0/fast/image-to-video',
  defaultDurationSec: 5,
};
