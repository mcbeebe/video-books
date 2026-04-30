import type { ChapterSpec, Scene } from '@video-books/types';
import {
  KLING,
  SEEDANCE,
  VEO,
  type VideoProviderConfig,
  type VideoProviderName,
} from '@video-books/video-gen';

/** A scene whose computed total duration exceeds the routed provider's max clip length. */
export interface ClipFeasibilityIssue {
  sceneN: number;
  sceneType: Scene['type'];
  provider: VideoProviderName;
  totalSec: number;
  maxSec: number;
  /** Always positive — how much trimming or splitting the scene needs. */
  overSec: number;
}

export interface ClipFeasibilityReport {
  ok: boolean;
  issues: ClipFeasibilityIssue[];
}

/** Default provider lookup table — mirrors what the CLI render command wires up. */
const DEFAULT_PROVIDERS: Record<VideoProviderName, VideoProviderConfig> = {
  kling: KLING,
  seedance: SEEDANCE,
  veo: VEO,
};

/**
 * Pure scene-feasibility check. For each scene, sum its beat seconds and
 * compare against the maxDurationSec of the provider that would be routed
 * to it. Architecture §6.4: each scene maps to one clip; this function
 * surfaces specs that need re-chunking before bulk render.
 *
 * @example
 *   const report = checkClipFeasibility(spec, pickProvider);
 *   if (!report.ok) report.issues.forEach((i) => console.warn(i));
 */
export function checkClipFeasibility(
  spec: ChapterSpec,
  pickProvider: (scene: Pick<Scene, 'type'>) => VideoProviderName,
  providers: Record<VideoProviderName, VideoProviderConfig> = DEFAULT_PROVIDERS,
): ClipFeasibilityReport {
  const issues: ClipFeasibilityIssue[] = [];
  for (const scene of spec.scenes) {
    const totalSec = scene.beats.reduce((sum, b) => sum + b.sec, 0);
    const provider = pickProvider(scene);
    const maxSec = providers[provider].maxDurationSec;
    if (totalSec > maxSec) {
      issues.push({
        sceneN: scene.n,
        sceneType: scene.type,
        provider,
        totalSec,
        maxSec,
        overSec: totalSec - maxSec,
      });
    }
  }
  return { ok: issues.length === 0, issues };
}

/** Format the report into a stable, human-readable block. */
export function formatFeasibility(report: ClipFeasibilityReport): string {
  if (report.ok) return "✓ all scenes fit within their routed provider's max clip length";
  const lines = report.issues.map(
    (i) =>
      `⚠  scene ${i.sceneN.toString()} (${i.sceneType}, ${i.provider}, max ${i.maxSec.toString()}s): ${i.totalSec.toString()}s — ${i.overSec.toString()}s over`,
  );
  lines.push(
    `${report.issues.length.toString()} scene(s) need beat re-chunking, multi-clip splits, or a provider swap before bulk render`,
  );
  return lines.join('\n');
}
