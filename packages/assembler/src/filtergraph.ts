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
   * Crossfade duration between consecutive scenes in seconds. Architecture §6.7
   * specifies 0.5s; PR #18 raised the default to 1.5s for sleep-niche
   * perceptibility. Set to 0 to use a hard concat (no overlap). Each scene's
   * total clip duration must be at least `2 × xfadeSec` for xfade to make sense.
   *
   * Note: sub-clips _within_ a scene are always concatenated with no fade
   * between them — multi-clip-per-scene chains via last-frame extraction so
   * the visual is continuous and a fade would just smear the seam.
   */
  xfadeSec?: number;
  /**
   * Per-scene array of sub-clip durations, in playback order. Required when
   * `xfadeSec > 0` so the filter graph can compute correct `offset` for each
   * scene-boundary xfade. The sum within each inner array equals the scene's
   * total clip duration. If omitted, falls back to one entry per scene
   * pulled from `timeline.scenes[i].durationSec`.
   *
   * Example: `[[8, 7], [5], [10, 10]]` → scene 1 has 2 sub-clips (8s + 7s),
   * scene 2 has 1, scene 3 has 2.
   */
  clipDurationsSec?: number[][];
}

/**
 * Build the FFmpeg command line for a finished timeline. Pure: no I/O, no
 * shell escaping needed (returns an args array; pass straight to spawn).
 *
 * Architecture §6.7:
 * - Concatenate clips with optional 0.5s+ crossfades (xfade) between SCENES.
 *   Sub-clips within a scene concat with no fade (chained continuously).
 * - Mix narration (loud) + ambient bed (quiet, -18 dB default)
 * - Encode H.264 yuv420p, +faststart for web
 *
 * Inputs (in order):
 *   0..K-1   sub-clip MP4s, scene-major (all of scene 1's sub-clips, then
 *            all of scene 2's, …) — total K = sum of sub-clip counts
 *   K..K+M-1 narration MP3s (one per beat, all scenes flattened)
 *   K+M      (optional) ambient bed
 */
export function buildFfmpegArgs(
  timeline: Timeline,
  options: BuildFfmpegArgsOptions,
): FfmpegInvocation {
  const ambientDb = options.ambientBedDb ?? -18;
  const preset = options.preset ?? 'slow';
  const crf = options.crf ?? 18;
  const xfadeSec = options.xfadeSec ?? 0;

  // Resolve clip-paths-per-scene and durations-per-scene from timeline
  const clipPathsPerScene: string[][] = timeline.scenes.map((s) => s.clipPaths);
  const clipDurationsPerScene: number[][] =
    options.clipDurationsSec ?? timeline.scenes.map((s) => [s.durationSec]);

  const flatClipPaths: string[] = clipPathsPerScene.flat();
  const beatPaths = timeline.scenes.flatMap((s) => s.beats.map((b) => b.audioPath));
  const ambientIndex =
    timeline.ambientBedPath !== null ? flatClipPaths.length + beatPaths.length : -1;

  const inputs: string[] = [];
  for (const path of [...flatClipPaths, ...beatPaths]) inputs.push('-i', path);
  if (timeline.ambientBedPath !== null)
    inputs.push('-stream_loop', '-1', '-i', timeline.ambientBedPath);

  const filterParts: string[] = [];

  // Build per-scene video streams: concat sub-clips within each scene
  // (no fade), labeled [s0v], [s1v], etc.
  let inputCursor = 0;
  const sceneStreamLabels: string[] = [];
  const sceneTotalDurations: number[] = [];
  for (let sIdx = 0; sIdx < clipPathsPerScene.length; sIdx += 1) {
    const subclipPaths = clipPathsPerScene[sIdx] ?? [];
    const subclipDurations = clipDurationsPerScene[sIdx] ?? [];
    sceneTotalDurations.push(subclipDurations.reduce((sum, d) => sum + d, 0));

    const inputIndices: number[] = subclipPaths.map(() => {
      const idx = inputCursor;
      inputCursor += 1;
      return idx;
    });

    const sceneLabel = `[s${sIdx.toString()}v]`;
    sceneStreamLabels.push(sceneLabel);

    const firstIdx = inputIndices[0] ?? 0;
    if (inputIndices.length === 1) {
      // Single sub-clip — just normalize fps/format/PTS
      filterParts.push(
        `[${firstIdx.toString()}:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS${sceneLabel}`,
      );
    } else {
      // Multiple sub-clips — normalize each then concat (no fade)
      for (const idx of inputIndices) {
        filterParts.push(
          `[${idx.toString()}:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s${sIdx.toString()}c${(idx - firstIdx).toString()}]`,
        );
      }
      const concatInputs = inputIndices
        .map((_, ci) => `[s${sIdx.toString()}c${ci.toString()}]`)
        .join('');
      filterParts.push(
        `${concatInputs}concat=n=${inputIndices.length.toString()}:v=1:a=0${sceneLabel}`,
      );
    }
  }

  // Now connect scene streams: either concat (no xfade) or xfade chain
  if (xfadeSec <= 0 || sceneStreamLabels.length < 2) {
    filterParts.push(
      `${sceneStreamLabels.join('')}concat=n=${sceneStreamLabels.length.toString()}:v=1:a=0[v]`,
    );
  } else {
    // xfade chain across scenes
    let cumulative = 0;
    let prev = sceneStreamLabels[0] ?? '[s0v]';
    for (let i = 1; i < sceneStreamLabels.length; i += 1) {
      cumulative += sceneTotalDurations[i - 1] ?? 0;
      const offset = cumulative - i * xfadeSec;
      const isLast = i === sceneStreamLabels.length - 1;
      const out = isLast ? '[v]' : `[xs${i.toString()}]`;
      const next = sceneStreamLabels[i] ?? `[s${i.toString()}v]`;
      filterParts.push(
        `${prev}${next}xfade=transition=fade:duration=${xfadeSec.toString()}:offset=${offset.toFixed(3)}${out}`,
      );
      prev = out;
    }
  }

  // Audio: always concat narration end-to-end (no fade — would clip words)
  filterParts.push(
    beatPaths.map((_, i) => `[${(flatClipPaths.length + i).toString()}:a]`).join('') +
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
