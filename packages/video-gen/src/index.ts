export { createVideoClient, type VideoClientConfig } from './client.js';
export { pickProvider } from './router.js';
export { KLING } from './providers/kling.js';
export { SEEDANCE } from './providers/seedance.js';
export { VEO } from './providers/veo.js';
export {
  VideoApiError,
  type VideoClient,
  type VideoError,
  type VideoGenerateInput,
  type VideoProviderConfig,
  type VideoProviderName,
  type VideoResult,
} from './types.js';
