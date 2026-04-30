import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ffprobe, runFfmpeg, verifyOutput, type FfprobeOutput } from './ffmpeg.js';

/** Returns true if `ffmpeg` is available on PATH. Lets us gate integration tests. */
function ffmpegAvailable(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

const HAS_FFMPEG = ffmpegAvailable();

describe('verifyOutput (pure)', () => {
  function probe(overrides: Partial<FfprobeOutput> = {}): FfprobeOutput {
    return {
      format: { duration: '60.0' },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'h264',
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080,
        },
        { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2 },
      ],
      ...overrides,
    };
  }

  it('passes when every check matches', () => {
    const r = verifyOutput(probe(), { expectedDurationSec: 60 });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('passes when duration is within ±tolerance', () => {
    expect(
      verifyOutput(probe({ format: { duration: '61.5' } }), { expectedDurationSec: 60 }).ok,
    ).toBe(true);
    expect(
      verifyOutput(probe({ format: { duration: '58.1' } }), { expectedDurationSec: 60 }).ok,
    ).toBe(true);
  });

  it('flags duration outside tolerance', () => {
    const r = verifyOutput(probe({ format: { duration: '70.0' } }), { expectedDurationSec: 60 });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/duration/);
  });

  it('flags wrong video codec', () => {
    const r = verifyOutput(
      probe({
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'vp9', pix_fmt: 'yuv420p' },
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
      { expectedDurationSec: 60 },
    );
    expect(r.isH264).toBe(false);
    expect(r.problems.some((p) => p.includes('h264'))).toBe(true);
  });

  it('flags wrong pixel format', () => {
    const r = verifyOutput(
      probe({
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv444p' },
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
      { expectedDurationSec: 60 },
    );
    expect(r.isYuv420p).toBe(false);
    expect(r.problems.some((p) => p.includes('yuv420p'))).toBe(true);
  });

  it('flags missing audio stream', () => {
    const r = verifyOutput(
      probe({
        streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }],
      }),
      { expectedDurationSec: 60 },
    );
    expect(r.hasAudio).toBe(false);
    expect(r.problems).toContain('expected at least one audio stream');
  });

  it('honors a custom tolerance', () => {
    const r = verifyOutput(probe({ format: { duration: '65' } }), {
      expectedDurationSec: 60,
      toleranceSec: 10,
    });
    expect(r.ok).toBe(true);
  });
});

describe.skipIf(!HAS_FFMPEG)('runFfmpeg + ffprobe (integration)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcap-asm-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('encodes a synthetic 1-second clip and ffprobe describes it', async () => {
    const out = join(dir, 'tiny.mp4');
    const { code, stderr } = await runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:size=128x72:rate=30',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=44100:cl=stereo',
      '-t',
      '1',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      out,
    ]);
    expect(code, stderr).toBe(0);

    const probe = await ffprobe(out);
    expect(probe.streams.some((s) => s.codec_name === 'h264')).toBe(true);
    expect(probe.streams.some((s) => s.codec_type === 'audio')).toBe(true);

    const verify = verifyOutput(probe, { expectedDurationSec: 1 });
    expect(verify.ok, verify.problems.join('; ')).toBe(true);
  });

  it('returns non-zero exit and stderr text on bad args', async () => {
    const { code, stderr } = await runFfmpeg(['-i', '/nonexistent/file.xyz', '/tmp/out.mp4']);
    expect(code).not.toBe(0);
    expect(stderr.length).toBeGreaterThan(0);
  });
});
