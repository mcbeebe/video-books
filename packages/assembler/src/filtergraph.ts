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
}

/**
 * Build the FFmpeg command line for a finished timeline. Pure: no I/O, no
 * shell escaping needed (returns an args array; pass straight to spawn).
 *
 * Architecture §6.7:
 * - Concatenate clips (crossfades are a future enhancement; this v1 uses
 *   simple `concat`)
 * - Mix narration (loud) + ambient bed (quiet, -18 dB default)
 * - Encode H.264 yuv420p, +faststart for web
 *
 * Inputs (in order):
 *   0..N-1  clip MP4s (one per scene)
 *   N..N+M-1 narration MP3s (one per beat, all scenes flattened)
 *   N+M     (optional) ambient bed
 *
 * @example
 *   const { args, outputPath } = buildFfmpegArgs(timeline, { outputPath: 'output/chapter-6.mp4' });
 *   await runFfmpeg(args);
 */
export function buildFfmpegArgs(
  timeline: Timeline,
  options: BuildFfmpegArgsOptions,
): FfmpegInvocation {
  const ambientDb = options.ambientBedDb ?? -18;
  const preset = options.preset ?? 'slow';
  const crf = options.crf ?? 18;

  const clipPaths = timeline.scenes.map((s) => s.clipPath);
  const beatPaths = timeline.scenes.flatMap((s) => s.beats.map((b) => b.audioPath));
  const ambientIndex = timeline.ambientBedPath !== null ? clipPaths.length + beatPaths.length : -1;

  const inputs: string[] = [];
  for (const path of [...clipPaths, ...beatPaths]) inputs.push('-i', path);
  if (timeline.ambientBedPath !== null)
    inputs.push('-stream_loop', '-1', '-i', timeline.ambientBedPath);

  const videoConcat =
    clipPaths.map((_, i) => `[${i.toString()}:v]`).join('') +
    `concat=n=${clipPaths.length.toString()}:v=1:a=0[v]`;

  const narrationConcat =
    beatPaths.map((_, i) => `[${(clipPaths.length + i).toString()}:a]`).join('') +
    `concat=n=${beatPaths.length.toString()}:v=0:a=1[narr]`;

  const filterParts = [videoConcat, narrationConcat];

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
