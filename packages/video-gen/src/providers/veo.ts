import type { VideoProviderConfig } from '../types.js';

/**
 * Veo 3.1 Fast (image-to-video). Architecture §3 calls out Veo as the
 * hero-scene high-fidelity option; we route HERO scenes here via
 * `pickProvider`. Path verified against https://fal.ai/models?keywords=veo
 * on 2026-04-29 — fal hosts the `image-to-video` variants separately from
 * the text-to-video ones; for our pipeline we always have a still already
 * so we always want the image-to-video endpoint.
 *
 * Switch to `fal-ai/veo3.1/image-to-video` (drop `/fast/`) for the
 * standard-quality variant if hero scenes need the polish.
 */
export const VEO: VideoProviderConfig = {
  name: 'veo',
  modelPath: 'fal-ai/veo3.1/fast/image-to-video',
  defaultDurationSec: 5,
};
