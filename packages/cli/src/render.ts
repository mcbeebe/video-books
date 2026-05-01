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
  /** Crossfade between consecutive clips, seconds (architecture §6.7). Defaults to 0.5s. Set 0 for hard cuts. */
  xfadeSec?: number;
  /** Tolerance the verify step uses on output duration. Defaults to 2s. Bump for long chapters where small per-clip rounding adds up. */
  verifyToleranceSec?: number;
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
  /**
   * Probe a cached audio (or video) file for its actual duration in seconds.
   * Forwarded to the orchestrator so video clips are sized to actual narration
   * length, not authored `beat.sec`. CLI passes a real ffprobe-backed impl;
   * tests can stub.
   */
  probeAudioDurationSec?: (path: string) => Promise<number>;
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

  // xfadeSec is read first so it can be passed to the orchestrator as
  // clipPaddingSec (each clip is sized to audio + fade so the fade-out
  // happens after the narration ends, not over it).
  const xfadeSec = options.xfadeSec ?? 1.5;

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
    clipPaddingSec: xfadeSec,
    ...(deps.probeAudioDurationSec ? { probeAudioDurationSec: deps.probeAudioDurationSec } : {}),
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
  });

  const timeline = buildTimeline(spec, {
    clipPathFor: (scene) => artifacts.clipPathFor(scene),
    audioPathFor: (beat) => artifacts.audioPathFor(beat),
    ambientBedPath: spec.ambientBed ?? null,
  });

  // Use measured clip durations for both verify-expected and the xfade chain.
  const measuredClipDurations = spec.scenes.map((s) => artifacts.clipDurationSecFor(s));
  const videoStreamSec =
    measuredClipDurations.reduce((sum, d) => sum + d, 0) -
    (xfadeSec > 0 ? Math.max(0, measuredClipDurations.length - 1) * xfadeSec : 0);
  // Audio stream: every beat's measured (or fallback authored) duration, summed.
  const audioStreamSec = spec.scenes
    .flatMap((s) => s.beats)
    .reduce((sum, b) => sum + artifacts.audioDurationSecFor(b), 0);
  // ffmpeg's -shortest trims output to whichever stream is shorter; verify
  // expects that final length, not just the video-stream length. Without
  // this min(), specs where ElevenLabs reads faster than the clip duration
  // (most of them, after our two-pass + ceil padding) trigger spurious
  // verifyOutput failures even though the rendered MP4 is correct.
  const expectedOutputSec = Math.min(videoStreamSec, audioStreamSec);

  const { args, filterGraph } = buildFfmpegArgs(timeline, {
    outputPath: options.outputPath,
    xfadeSec,
    clipDurationsSec: measuredClipDurations,
  });

  deps.logger.log(`Encoding to ${options.outputPath}… (xfade=${xfadeSec.toString()}s)`);
  deps.logger.log(`  filter_complex: ${filterGraph}`);
  const { code, stderr } = await deps.runFfmpeg(args);
  if (code !== 0) {
    throw new Error(`ffmpeg exited ${code.toString()}: ${stderr}`);
  }

  const probe = await deps.ffprobe(options.outputPath);
  const verify = verifyOutput(probe, {
    expectedDurationSec: expectedOutputSec,
    ...(options.verifyToleranceSec !== undefined
      ? { toleranceSec: options.verifyToleranceSec }
      : {}),
  });
  if (!verify.ok) {
    throw new Error(`output verification failed: ${verify.problems.join('; ')}`);
  }

  deps.logger.log(`✓ Rendered ${options.outputPath} (${expectedOutputSec.toFixed(1)}s)`);
  return {
    cost,
    timeline,
    ffmpegArgs: args,
    ffmpegCode: code,
    verify,
    outputPath: options.outputPath,
  };
}
