import type { VideoProviderConfig } from '../types.js';

/**
 * Seedance 2.0 Fast (architecture §3 cost-tier alternate, ~$0.022/sec at
 * 1080p). Verify model path before smoke testing.
 */
export const SEEDANCE: VideoProviderConfig = {
  name: 'seedance',
  modelPath: 'fal-ai/seedance/v2/fast',
  defaultDurationSec: 5,
};
