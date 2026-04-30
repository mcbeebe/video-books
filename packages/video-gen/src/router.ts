import type { Scene } from '@video-books/types';
import type { VideoProviderName } from './types.js';

/**
 * Architecture §6.4: HERO scenes optionally route to Veo 3.1 for higher
 * fidelity. Standard scenes go to Kling (the cost-effective default).
 * Pure function — easy to override per-scene from the CLI.
 *
 * @example
 *   const provider = pickProvider(scene); // 'veo' | 'kling'
 *   const result = await videoClient.generate({ image, motion: scene.motion, provider });
 */
export function pickProvider(scene: Pick<Scene, 'type'>): VideoProviderName {
  return scene.type === 'HERO' ? 'veo' : 'kling';
}
