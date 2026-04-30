import type { VideoProviderConfig } from '../types.js';

/**
 * Kling Video v3 Pro (image-to-video). Architecture §3 names Kling 3.0 as
 * the primary video provider for SCENE-typed scenes. Path verified against
 * https://fal.ai/models?keywords=kling on 2026-04-29 — fal hosts v3 only
 * in the Pro tier (no `standard` variant); for cheaper output use
 * `kling-video/v2.5-turbo/pro/image-to-video`.
 */
export const KLING: VideoProviderConfig = {
  name: 'kling',
  modelPath: 'fal-ai/kling-video/v3/pro/image-to-video',
  defaultDurationSec: 5,
};
