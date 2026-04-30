import type { VideoProviderConfig } from '../types.js';

/**
 * Veo 3.1 Lite (architecture §3 hero-scene high-fidelity option, $0.05/sec
 * with audio included). Available via fal.ai routing or direct Google
 * Vertex AI — fal.ai is simpler to wire for the pilot. Verify before smoke.
 */
export const VEO: VideoProviderConfig = {
  name: 'veo',
  modelPath: 'fal-ai/veo3/lite',
  defaultDurationSec: 5,
  bodyExtras: { with_audio: false },
};
