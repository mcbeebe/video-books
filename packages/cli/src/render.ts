import {
  buildFfmpegArgs,
  buildTimeline,
  verifyOutput,
  type FfprobeOutput,
  type Timeline,
  type VerifyResult,
} from '@video-books/assembler';
import type { CacheStore } from '@video-books/cache';
import type { ChapterSpec } from '@video-books/types';
import { estimateCost, formatCost, type CostBreakdown, type CostRates } from './cost.js';
import {
  generateArtifacts,
  type ImageGenerator,
  type NarrationGenerator,
  type ProgressEvent,
  type ProviderRouter,
  type VideoGenerator,
} from './orchestrator.js';

/** Logger interface — matches the one in main.ts. */
export interface RenderLogger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RenderOptions {
  outputPath: string;
  /** Refuse to render if the cost estimate exceeds this. */
  maxCostUsd: number;
  /** Skip the over-budget guard. Caller has eyeballed the cost. */
  confirm: boolean;
  /** Override the cost rates if your contracts differ. */
  rates?: CostRates;
}

export interface RenderDeps {
  cache: CacheStore;
  imageClient: ImageGenerator;
  videoClient: VideoGenerator;
  narrationClient: NarrationGenerator;
  pickProvider: ProviderRouter;
  styleAnchor: string;
  imageProvider: string;
  imageModel: string;
  narrationVoiceId: string;
  narrationModel: string;
  /** Run ffmpeg. Tests inject a stub that records args; CLI uses `runFfmpeg` from assembler. */
  runFfmpeg: (args: string[]) => Promise<{ code: number; stderr: string }>;
  /** Probe the output. Tests inject a stub returning a valid FfprobeOutput. */
  ffprobe: (path: string) => Promise<FfprobeOutput>;
  logger: RenderLogger;
  /** Optional progress callback for the orchestrator stage. */
  onProgress?: (event: ProgressEvent) => void;
}

/** What the render returned — fields useful for `wcap render` output. */
export interface RenderResult {
  cost: CostBreakdown;
  timeline: Timeline;
  ffmpegArgs: string[];
  ffmpegCode: number;
  verify: VerifyResult;
  outputPath: string;
}

/**
 * End-to-end render: cost preflight → orchestrator → timeline → ffmpeg → verify.
 * All external dependencies are injected; the CLI wires real clients, tests
 * inject mocks.
 *
 * Throws if:
 * - cost exceeds `maxCostUsd` and `confirm` is false
 * - ffmpeg returns non-zero (with stderr in the message)
 * - verifyOutput fails
 */
export async function runRender(
  spec: ChapterSpec,
  deps: RenderDeps,
  options: RenderOptions,
): Promise<RenderResult> {
  const cost = estimateCost(spec, options.rates);
  deps.logger.log(formatCost(cost));
  if (cost.totalUsd > options.maxCostUsd && !options.confirm) {
    throw new Error(
      `cost estimate $${cost.totalUsd.toFixed(2)} exceeds --max-cost $${options.maxCostUsd.toFixed(2)}; pass --confirm to proceed`,
    );
  }

  deps.logger.log('Generating artifacts…');
  const artifacts = await generateArtifacts(spec, {
    cache: deps.cache,
    imageClient: deps.imageClient,
    videoClient: deps.videoClient,
    narrationClient: deps.narrationClient,
    pickProvider: deps.pickProvider,
    styleAnchor: deps.styleAnchor,
    imageProvider: deps.imageProvider,
    imageModel: deps.imageModel,
    narrationVoiceId: deps.narrationVoiceId,
    narrationModel: deps.narrationModel,
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
  });

  const timeline = buildTimeline(spec, {
    clipPathFor: (scene) => artifacts.clipPathFor(scene),
    audioPathFor: (beat) => artifacts.audioPathFor(beat),
    ambientBedPath: spec.ambientBed ?? null,
  });

  const { args } = buildFfmpegArgs(timeline, { outputPath: options.outputPath });

  deps.logger.log(`Encoding to ${options.outputPath}…`);
  const { code, stderr } = await deps.runFfmpeg(args);
  if (code !== 0) {
    throw new Error(`ffmpeg exited ${code.toString()}: ${stderr}`);
  }

  const probe = await deps.ffprobe(options.outputPath);
  const verify = verifyOutput(probe, { expectedDurationSec: timeline.totalDurationSec });
  if (!verify.ok) {
    throw new Error(`output verification failed: ${verify.problems.join('; ')}`);
  }

  deps.logger.log(`✓ Rendered ${options.outputPath} (${timeline.totalDurationSec.toString()}s)`);
  return {
    cost,
    timeline,
    ffmpegArgs: args,
    ffmpegCode: code,
    verify,
    outputPath: options.outputPath,
  };
}
