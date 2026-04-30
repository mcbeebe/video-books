import type { VideoProviderConfig } from '../types.js';

/**
 * Kling Video v3 Pro (image-to-video). Architecture §3 names Kling 3.0 as
 * the primary video provider for SCENE-typed scenes. Path + schema
 * verified live on 2026-04-29 against
 * https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video.
 *
 * Notable schema quirk: Kling uses `start_image_url` (not `image_url`)
 * and accepts `duration` as a stringified integer "3" through "15"
 * (no `s` suffix, no auto). Default "5".
 *
 * For cheaper output use `kling-video/v2.5-turbo/pro/image-to-video`.
 */
export const KLING: VideoProviderConfig = {
  name: 'kling',
  modelPath: 'fal-ai/kling-video/v3/pro/image-to-video',
  defaultDurationSec: 5,
  formatRequest: ({ imageUrl, prompt, durationSec }) => ({
    start_image_url: imageUrl,
    prompt,
    duration: clampInt(durationSec, 3, 15).toString(),
  }),
};

function clampInt(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}
