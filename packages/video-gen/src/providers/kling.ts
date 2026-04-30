import type { VideoProviderConfig } from '../types.js';

/**
 * Kling 3.0 (architecture §3 primary video provider). fal.ai routes to
 * `fal-ai/kling-video/v3/std`. Verify the exact model path against
 * https://fal.ai/models?keywords=kling before smoke testing — fal often
 * iterates these slugs (e.g. `v1.6/standard` was the 2025 path).
 */
export const KLING: VideoProviderConfig = {
  name: 'kling',
  modelPath: 'fal-ai/kling-video/v3/std',
  defaultDurationSec: 5,
};
