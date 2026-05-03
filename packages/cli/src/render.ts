import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  type Artifacts,
  type ImageGenerator,
  type NarrationGenerator,
  type ProgressEvent,
  type ProviderMaxDurationLookup,
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
  /**
   * If set, emit one MP4 per scene to this directory (filenames
   * `{spec.slug}-scene-{NNN}.mp4`, zero-padded for sortable iMovie import)
   * INSTEAD of a single concatenated master MP4. Each per-scene MP4 contains
   * just that scene's video clips (concat, no fade) and that scene's
   * narration audio (concat, no fade), mixed with the optional ambient bed.
   *
   * Use case: hand the user a folder of clips they can drop into iMovie /
   * DaVinci / Final Cut and add transitions there. Avoids paying for the
   * +1.5s xfade tail (`clipPaddingSec` is forced to 0) and skips the
   * single-master ffmpeg pass. `xfadeSec` is ignored in this mode.
   *
   * Mutually exclusive with `outputPath` semantics — when this is set,
   * `outputPath` is treated as a no-op placeholder and the per-scene paths
   * are returned in `RenderResult.perSceneOutputPaths`.
   */
  perSceneOutputDir?: string;
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
  /**
   * Extract the very last frame of a cached clip as PNG bytes. Required for
   * multi-clip-per-scene chaining (long scenes split into N sub-clips).
   * CLI passes the assembler's `extractLastFrame`; tests stub.
   */
  extractLastFrame?: (clipPath: string) => Promise<Uint8Array>;
  /**
   * Per-provider max clip length lookup. Required when `extractLastFrame` is
   * set so the orchestrator knows when to split. CLI builds from
   * `@video-books/video-gen` provider configs.
   */
  providerMaxDurationSec?: ProviderMaxDurationLookup;
  logger: RenderLogger;
  /** Optional progress callback for the orchestrator stage. */
  onProgress?: (event: ProgressEvent) => void;
}

/** What the render returned — fields useful for `wcap render` output. */
export interface RenderResult {
  cost: CostBreakdown;
  timeline: Timeline;
  /**
   * ffmpeg args from the master concat pass (master mode), or from the LAST
   * per-scene pass (per-scene mode — useful for debug logging only).
   */
  ffmpegArgs: string[];
  ffmpegCode: number;
  /** Verify result from the master MP4. `null` in per-scene mode. */
  verify: VerifyResult | null;
  outputPath: string;
  /** Populated only in per-scene mode. Empty array in master mode. */
  perSceneOutputPaths: string[];
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

  // xfadeSec also doubles as clipPaddingSec for the orchestrator (each clip
  // gets sized to audio + fade so the fade-out happens after narration ends,
  // not over it). In per-scene mode there's no fade to pad for, so we force
  // padding to 0 — this saves ~$14/chapter at v2.5-turbo, ~$28 at v3/pro.
  const perSceneMode = options.perSceneOutputDir !== undefined;
  const xfadeSec = perSceneMode ? 0 : (options.xfadeSec ?? 1.5);
  const clipPaddingSec = perSceneMode ? 0 : xfadeSec;

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
    clipPaddingSec,
    ...(deps.probeAudioDurationSec ? { probeAudioDurationSec: deps.probeAudioDurationSec } : {}),
    ...(deps.extractLastFrame ? { extractLastFrame: deps.extractLastFrame } : {}),
    ...(deps.providerMaxDurationSec ? { providerMaxDurationSec: deps.providerMaxDurationSec } : {}),
    ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
  });

  const timeline = buildTimeline(spec, {
    clipPathsFor: (scene) => artifacts.clipPathsFor(scene),
    audioPathFor: (beat) => artifacts.audioPathFor(beat),
    ambientBedPath: spec.ambientBed ?? null,
  });

  if (perSceneMode) {
    return runPerSceneRender(spec, artifacts, timeline, deps, options, cost);
  }

  // Per-scene sub-clip durations for the xfade chain.
  const clipDurationsPerScene = spec.scenes.map((s) => artifacts.clipDurationsSecFor(s));
  const totalClipSec = clipDurationsPerScene.flat().reduce((sum, d) => sum + d, 0);
  const videoStreamSec =
    totalClipSec - (xfadeSec > 0 ? Math.max(0, clipDurationsPerScene.length - 1) * xfadeSec : 0);
  // Audio stream: every beat's measured (or fallback authored) duration, summed.
  const audioStreamSec = spec.scenes
    .flatMap((s) => s.beats)
    .reduce((sum, b) => sum + artifacts.audioDurationSecFor(b), 0);
  // ffmpeg's -shortest trims output to whichever stream is shorter; verify
  // expects that final length, not just the video-stream length.
  const expectedOutputSec = Math.min(videoStreamSec, audioStreamSec);

  const { args, filterGraph } = buildFfmpegArgs(timeline, {
    outputPath: options.outputPath,
    xfadeSec,
    clipDurationsSec: clipDurationsPerScene,
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
    perSceneOutputPaths: [],
  };
}

/**
 * Per-scene render branch: emits one MP4 per scene to `perSceneOutputDir`,
 * named `{spec.slug}-scene-{NNN}.mp4` (3-digit zero-padded for sortable
 * iMovie import). Each MP4 holds that scene's clips concatenated with hard
 * cuts (no inter-clip fade) and that scene's narration audio. The user
 * applies their own transitions in iMovie / DaVinci / Final Cut.
 *
 * Reuses `buildFfmpegArgs` by treating each scene as a one-scene mini-spec
 * with `xfadeSec=0` so we don't reinvent the audio mix / format / encode
 * pipeline.
 */
async function runPerSceneRender(
  spec: ChapterSpec,
  artifacts: Artifacts,
  timeline: Timeline,
  deps: RenderDeps,
  options: RenderOptions,
  cost: CostBreakdown,
): Promise<RenderResult> {
  const outputDir = options.perSceneOutputDir;
  if (outputDir === undefined) {
    throw new Error('runPerSceneRender called without perSceneOutputDir');
  }
  await mkdir(outputDir, { recursive: true });

  const perSceneOutputPaths: string[] = [];
  let lastArgs: string[] = [];
  let lastCode = 0;

  for (let i = 0; i < spec.scenes.length; i += 1) {
    const scene = spec.scenes[i];
    if (scene === undefined) continue;
    const sceneTimeline = timeline.scenes[i];
    if (sceneTimeline === undefined) continue;

    const sceneNumStr = scene.n.toString().padStart(3, '0');
    const filename = `${spec.slug}-scene-${sceneNumStr}.mp4`;
    const sceneOutputPath = join(outputDir, filename);
    await mkdir(dirname(sceneOutputPath), { recursive: true });

    // Build a one-scene mini-timeline so buildFfmpegArgs handles concat/mix
    // without us reimplementing it.
    const miniTimeline: Timeline = {
      ...timeline,
      scenes: [sceneTimeline],
    };

    const { args, filterGraph } = buildFfmpegArgs(miniTimeline, {
      outputPath: sceneOutputPath,
      xfadeSec: 0,
      clipDurationsSec: [artifacts.clipDurationsSecFor(scene)],
    });

    deps.logger.log(`  Encoding scene ${scene.n.toString()} → ${filename}`);
    deps.logger.log(`    filter_complex: ${filterGraph}`);
    const { code, stderr } = await deps.runFfmpeg(args);
    if (code !== 0) {
      throw new Error(`ffmpeg scene ${scene.n.toString()} exited ${code.toString()}: ${stderr}`);
    }
    perSceneOutputPaths.push(sceneOutputPath);
    lastArgs = args;
    lastCode = code;
  }

  deps.logger.log(
    `✓ Rendered ${perSceneOutputPaths.length.toString()} scene MP4s to ${outputDir}/`,
  );
  return {
    cost,
    timeline,
    ffmpegArgs: lastArgs,
    ffmpegCode: lastCode,
    verify: null,
    outputPath: outputDir,
    perSceneOutputPaths,
  };
}
