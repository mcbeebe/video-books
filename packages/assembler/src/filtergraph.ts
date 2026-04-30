import type { Timeline } from './timeline.js';

/** Result of {@link buildFfmpegArgs} — what to pass to `runFfmpeg`. */
export interface FfmpegInvocation {
  /** Argument array (no `ffmpeg` prefix). */
  args: string[];
  /** Filter graph string for debug/logging. */
  filterGraph: string;
  /** Path the encoder will write to. */
  outputPath: string;
}

export interface BuildFfmpegArgsOptions {
  /** Where to write the master MP4. */
  outputPath: string;
  /** Ambient bed level in dB (negative = quieter). Defaults to -18 dB per architecture §6.7. */
  ambientBedDb?: number;
  /** Encoder preset (libx264). Defaults to `slow` for quality; use `fast` for previews. */
  preset?: string;
  /** Constant Rate Factor — lower = better. Defaults to 18 (visually lossless-ish). */
  crf?: number;
  /**
   * Crossfade duration between consecutive clips in seconds. Architecture §6.7
   * specifies 0.5s. Set to 0 to use a hard concat (no overlap). Each clip must
   * be at least `2 × xfadeSec` long for xfade to make sense.
   */
  xfadeSec?: number;
  /**
   * Actual clip durations in seconds, in scene order. Required when
   * `xfadeSec > 0` so the filter graph can compute correct `offset` for each
   * xfade boundary. If omitted, falls back to `timeline.scenes[i].durationSec`.
   */
  clipDurationsSec?: number[];
}

/**
 * Build the FFmpeg command line for a finished timeline. Pure: no I/O, no
 * shell escaping needed (returns an args array; pass straight to spawn).
 *
 * Architecture §6.7:
 * - Concatenate clips with optional 0.5s crossfades (xfade)
 * - Mix narration (loud) + ambient bed (quiet, -18 dB default)
 * - Encode H.264 yuv420p, +faststart for web
 *
 * Inputs (in order):
 *   0..N-1   clip MP4s (one per scene)
 *   N..N+M-1 narration MP3s (one per beat, all scenes flattened)
 *   N+M      (optional) ambient bed
 *
 * @example
 *   const { args, outputPath } = buildFfmpegArgs(timeline, {
 *     outputPath: 'output/chapter-6.mp4',
 *     xfadeSec: 0.5,
 *     clipDurationsSec: timeline.scenes.map((s) => s.durationSec),
 *   });
 *   await runFfmpeg(args);
 */
export function buildFfmpegArgs(
  timeline: Timeline,
  options: BuildFfmpegArgsOptions,
): FfmpegInvocation {
  const ambientDb = options.ambientBedDb ?? -18;
  const preset = options.preset ?? 'slow';
  const crf = options.crf ?? 18;
  const xfadeSec = options.xfadeSec ?? 0;
  const clipDurations = options.clipDurationsSec ?? timeline.scenes.map((s) => s.durationSec);

  const clipPaths = timeline.scenes.map((s) => s.clipPath);
  const beatPaths = timeline.scenes.flatMap((s) => s.beats.map((b) => b.audioPath));
  const ambientIndex = timeline.ambientBedPath !== null ? clipPaths.length + beatPaths.length : -1;

  const inputs: string[] = [];
  for (const path of [...clipPaths, ...beatPaths]) inputs.push('-i', path);
  if (timeline.ambientBedPath !== null)
    inputs.push('-stream_loop', '-1', '-i', timeline.ambientBedPath);

  const filterParts: string[] = [];

  // Video: concat or xfade chain
  if (xfadeSec <= 0 || clipPaths.length < 2) {
    filterParts.push(
      clipPaths.map((_, i) => `[${i.toString()}:v]`).join('') +
        `concat=n=${clipPaths.length.toString()}:v=1:a=0[v]`,
    );
  } else {
    filterParts.push(...buildXfadeChain(clipPaths.length, clipDurations, xfadeSec));
  }

  // Audio: always concat narration end-to-end (no fade — would clip words)
  filterParts.push(
    beatPaths.map((_, i) => `[${(clipPaths.length + i).toString()}:a]`).join('') +
      `concat=n=${beatPaths.length.toString()}:v=0:a=1[narr]`,
  );

  let audioMapTarget = '[narr]';
  if (ambientIndex >= 0) {
    filterParts.push(`[${ambientIndex.toString()}:a]volume=${ambientDb.toString()}dB[amb]`);
    filterParts.push(`[narr][amb]amix=inputs=2:duration=first:dropout_transition=0[a]`);
    audioMapTarget = '[a]';
  }

  const filterGraph = filterParts.join(';');

  const args: string[] = [
    '-y', // overwrite output
    ...inputs,
    '-filter_complex',
    filterGraph,
    '-map',
    '[v]',
    '-map',
    audioMapTarget,
    '-r',
    timeline.output.fps.toString(),
    '-c:v',
    'libx264',
    '-preset',
    preset,
    '-crf',
    crf.toString(),
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    options.outputPath,
  ];

  return { args, filterGraph, outputPath: options.outputPath };
}

/**
 * Build the xfade chain for N clips. For each consecutive pair, emit:
 *
 *   [aN][bN]xfade=transition=fade:duration=D:offset=O[xN]
 *
 * where O is the time at which the fade should *start* in the prior stream.
 * For 3 clips with durations T0, T1, T2 and fade D:
 *
 *   [0:v]setpts=PTS-STARTPTS[v0];
 *   [1:v]setpts=PTS-STARTPTS[v1];
 *   [2:v]setpts=PTS-STARTPTS[v2];
 *   [v0][v1]xfade=transition=fade:duration=D:offset=T0-D[xv1];
 *   [xv1][v2]xfade=transition=fade:duration=D:offset=T0+T1-2D[v];
 *
 * Output stream is labeled `[v]`. Total output video duration:
 *   sum(Ti) - (N-1)*D
 */
function buildXfadeChain(n: number, durations: number[], fadeSec: number): string[] {
  const parts: string[] = [];

  // Pre-pass per clip: normalize to constant 30fps + yuv420p + reset PTS.
  // xfade requires inputs to share fps, format, and SAR; provider clips can
  // have variable framerate (especially fal.ai → kling) and that silently
  // breaks the fade (it renders as a hard cut). Forcing fps + format here
  // makes the fade actually visible.
  for (let i = 0; i < n; i += 1) {
    parts.push(`[${i.toString()}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${i.toString()}]`);
  }

  // Chain xfades. After k fades, cumulative output duration = sum(T0..Tk) - k*D
  // The (k+1)-th fade starts at that time minus D.
  let cumulative = 0;
  let prev = '[v0]';
  for (let i = 1; i < n; i += 1) {
    cumulative += durations[i - 1] ?? 0;
    const offset = cumulative - i * fadeSec;
    const isLast = i === n - 1;
    const out = isLast ? '[v]' : `[xv${i.toString()}]`;
    parts.push(
      `${prev}[v${i.toString()}]xfade=transition=fade:duration=${fadeSec.toString()}:offset=${offset.toFixed(3)}${out}`,
    );
    prev = out;
  }

  return parts;
}
