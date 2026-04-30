import type { VideoProviderConfig } from '../types.js';

/** Veo 3.1 fast i2v accepts only these duration literals. */
const VEO_DURATIONS = [4, 6, 8] as const;

/**
 * Veo 3.1 Fast (image-to-video). Architecture §3 calls out Veo as the
 * hero-scene high-fidelity option; we route HERO scenes here via
 * `pickProvider`. Path verified live on 2026-04-29 against
 * https://fal.ai/models?keywords=veo. Schema details from the API page:
 *
 *   - prompt (string), image_url (string) — required
 *   - duration: enum "4s" | "6s" | "8s" (default "8s")
 *   - resolution: "720p" | "1080p" | "4k" (default "720p")
 *   - generate_audio: boolean (default true) — we leave on
 *
 * Switch to `fal-ai/veo3.1/image-to-video` (drop `/fast/`) for the
 * standard-quality variant if hero scenes need the polish.
 */
export const VEO: VideoProviderConfig = {
  name: 'veo',
  modelPath: 'fal-ai/veo3.1/fast/image-to-video',
  defaultDurationSec: 6,
  formatRequest: ({ imageUrl, prompt, durationSec }) => ({
    image_url: imageUrl,
    prompt,
    duration: `${nearestUp(durationSec, VEO_DURATIONS).toString()}s`,
  }),
};

/** Round `n` up to the smallest allowed value ≥ n; clamp to max if all smaller. */
function nearestUp(n: number, allowed: readonly number[]): number {
  for (const v of allowed) if (v >= n) return v;
  return allowed.at(-1) ?? n;
}
