import type { ChapterSpec } from '@video-books/types';

/** Per-call rates (USD). Override per-run if your rates differ. */
export interface CostRates {
  /** $/image. Default approximates Midjourney v7 marginal. */
  imageUsd: number;
  /** $/video-second for SCENE-typed scenes (default Kling 3.0 ≈ $0.07). */
  videoSceneUsdPerSec: number;
  /** $/video-second for HERO-typed scenes (default Veo 3.1 Lite ≈ $0.05). */
  videoHeroUsdPerSec: number;
  /** $/character for narration (default ElevenLabs Creator ≈ $22 / 100K). */
  narrationUsdPerChar: number;
}

export const DEFAULT_RATES: CostRates = {
  imageUsd: 0.05,
  videoSceneUsdPerSec: 0.07,
  videoHeroUsdPerSec: 0.05,
  narrationUsdPerChar: 22 / 100_000,
};

export interface CostBreakdown {
  imageCount: number;
  imageUsd: number;
  videoSec: number;
  videoUsd: number;
  narrationChars: number;
  narrationUsd: number;
  totalUsd: number;
}

/**
 * Pure cost preflight per architecture §6.2 / §10. Sums across the spec
 * using the provided rates (or {@link DEFAULT_RATES}). Caller is responsible
 * for refusing to proceed if `totalUsd` exceeds their budget.
 *
 * @example
 *   const cost = estimateCost(spec);
 *   if (cost.totalUsd > 50) throw new Error(`would spend $${cost.totalUsd.toFixed(2)}`);
 */
export function estimateCost(spec: ChapterSpec, rates: CostRates = DEFAULT_RATES): CostBreakdown {
  const imageCount = spec.scenes.length;
  let videoSec = 0;
  let videoUsd = 0;
  let narrationChars = 0;
  for (const scene of spec.scenes) {
    const sceneSec = scene.beats.reduce((s, b) => s + b.sec, 0);
    videoSec += sceneSec;
    videoUsd +=
      sceneSec * (scene.type === 'HERO' ? rates.videoHeroUsdPerSec : rates.videoSceneUsdPerSec);
    narrationChars += scene.beats.reduce((s, b) => s + b.text.length, 0);
  }
  const imageUsd = imageCount * rates.imageUsd;
  const narrationUsd = narrationChars * rates.narrationUsdPerChar;
  return {
    imageCount,
    imageUsd,
    videoSec,
    videoUsd,
    narrationChars,
    narrationUsd,
    totalUsd: imageUsd + videoUsd + narrationUsd,
  };
}

/** Human-readable summary table — used by `wcap cost` and the render preflight. */
export function formatCost(b: CostBreakdown): string {
  const fmt = (n: number): string => `$${n.toFixed(2)}`;
  return [
    `Images:    ${b.imageCount.toString().padStart(5)} × ≈ ${fmt(b.imageUsd / Math.max(1, b.imageCount))} = ${fmt(b.imageUsd)}`,
    `Video:     ${b.videoSec.toString().padStart(5)}s        = ${fmt(b.videoUsd)}`,
    `Narration: ${b.narrationChars.toString().padStart(5)} chars       = ${fmt(b.narrationUsd)}`,
    `─────────────────────────────────────────`,
    `Total:                          ${fmt(b.totalUsd)}`,
  ].join('\n');
}
