import { spawn } from 'node:child_process';

/** Result of a `runFfmpeg` invocation. */
export interface RunResult {
  /** Process exit code; 0 means success. */
  code: number;
  /** Captured stderr — FFmpeg writes progress + errors here. */
  stderr: string;
}

export interface RunFfmpegOptions {
  /** Path to the ffmpeg binary. Defaults to `ffmpeg` (resolved from $PATH). */
  binary?: string;
  /** Optional callback invoked with each chunk of stderr (for progress reporting). */
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

/**
 * Run ffmpeg with the given args. Resolves with the exit code + captured
 * stderr; never rejects on non-zero exit (callers branch on `code`). Rejects
 * only if the process couldn't be spawned at all (e.g. ffmpeg missing from
 * $PATH).
 *
 * @example
 *   const { code, stderr } = await runFfmpeg(args);
 *   if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr}`);
 */
export async function runFfmpeg(
  args: string[],
  options: RunFfmpegOptions = {},
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(options.binary ?? 'ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(options.signal ? { signal: options.signal } : {}),
    });

    const chunks: string[] = [];
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      chunks.push(chunk);
      options.onStderr?.(chunk);
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve({ code: code ?? -1, stderr: chunks.join('') });
    });
  });
}

/**
 * Extract the very last frame of a video file as a PNG byte array. Used by
 * the multi-clip-per-scene flow to chain consecutive sub-clips: feed the
 * last frame of clip K to the video provider as the start image for clip
 * K+1 so the visual continues smoothly instead of restarting from the
 * scene's still.
 *
 * @example
 *   const lastFrame = await extractLastFrame('cache/clips/abc.mp4');
 *   await videoClient.generate({ image: lastFrame, motion, durationSec: ... });
 */
export async function extractLastFrame(
  inputPath: string,
  options: { binary?: string; signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const child = spawn(
      options.binary ?? 'ffmpeg',
      [
        // -sseof seeks from end of file (negative seconds = from the end)
        '-sseof',
        '-0.05',
        '-i',
        inputPath,
        // -frames:v 1 — write a single video frame
        '-frames:v',
        '1',
        // High-quality PNG to stdout
        '-f',
        'image2',
        '-vcodec',
        'png',
        '-loglevel',
        'error',
        'pipe:1',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    const chunks: Buffer[] = [];
    const stderrChunks: string[] = [];
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c: string) => stderrChunks.push(c));

    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `extractLastFrame: ffmpeg exited ${(code ?? -1).toString()}: ${stderrChunks.join('')}`,
          ),
        );
        return;
      }
      const buf = Buffer.concat(chunks);
      resolve(new Uint8Array(buf));
    });
  });
}

/**
 * Run ffprobe on a file and return a parsed JSON description.
 *
 * @example
 *   const probe = await ffprobe('output/chapter-6.mp4');
 *   const audioStream = probe.streams.find((s) => s.codec_type === 'audio');
 */
export async function ffprobe(
  inputPath: string,
  options: { binary?: string; signal?: AbortSignal } = {},
): Promise<FfprobeOutput> {
  return new Promise<FfprobeOutput>((resolve, reject) => {
    const child = spawn(
      options.binary ?? 'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', inputPath],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c: string) => stdoutChunks.push(c));
    child.stderr.on('data', (c: string) => stderrChunks.push(c));

    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited ${(code ?? -1).toString()}: ${stderrChunks.join('')}`));
        return;
      }
      try {
        resolve(JSON.parse(stdoutChunks.join('')) as FfprobeOutput);
      } catch (cause) {
        reject(new Error(`ffprobe JSON parse failed: ${String(cause)}`));
      }
    });
  });
}

export interface FfprobeStream {
  index: number;
  codec_type: 'video' | 'audio' | 'subtitle' | 'data';
  codec_name?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  sample_rate?: string;
  channels?: number;
}

export interface FfprobeFormat {
  duration?: string;
  size?: string;
  bit_rate?: string;
  format_name?: string;
}

export interface FfprobeOutput {
  streams: FfprobeStream[];
  format: FfprobeFormat;
}

/** Result of {@link verifyOutput}: every required check + a single `ok` summary. */
export interface VerifyResult {
  ok: boolean;
  durationMatches: boolean;
  durationSec: number;
  expectedDurationSec: number;
  isH264: boolean;
  isYuv420p: boolean;
  hasAudio: boolean;
  problems: string[];
}

/**
 * Verify a rendered MP4 matches architecture §6.8 requirements:
 * - Duration within ±toleranceSec of expected (default 2s)
 * - Video codec is H.264, pixel format yuv420p
 * - Has at least one audio stream
 *
 * Pure parser — pass an `FfprobeOutput` directly. For convenience, callers
 * typically do `verifyOutput(await ffprobe(path), { expectedDurationSec })`.
 */
export function verifyOutput(
  probe: FfprobeOutput,
  options: { expectedDurationSec: number; toleranceSec?: number },
): VerifyResult {
  const tolerance = options.toleranceSec ?? 2;
  const durationSec = probe.format.duration !== undefined ? Number(probe.format.duration) : NaN;
  const durationMatches =
    Number.isFinite(durationSec) &&
    Math.abs(durationSec - options.expectedDurationSec) <= tolerance;

  const video = probe.streams.find((s) => s.codec_type === 'video');
  const audio = probe.streams.find((s) => s.codec_type === 'audio');
  const isH264 = video?.codec_name === 'h264';
  const isYuv420p = video?.pix_fmt === 'yuv420p';
  const hasAudio = audio !== undefined;

  const problems: string[] = [];
  if (!durationMatches) {
    problems.push(
      `duration ${durationSec.toString()}s outside ±${tolerance.toString()}s of expected ${options.expectedDurationSec.toString()}s`,
    );
  }
  if (!isH264) problems.push(`expected video codec h264, got ${video?.codec_name ?? '<none>'}`);
  if (!isYuv420p) problems.push(`expected pix_fmt yuv420p, got ${video?.pix_fmt ?? '<none>'}`);
  if (!hasAudio) problems.push('expected at least one audio stream');

  return {
    ok: problems.length === 0,
    durationMatches,
    durationSec,
    expectedDurationSec: options.expectedDurationSec,
    isH264,
    isYuv420p,
    hasAudio,
    problems,
  };
}
