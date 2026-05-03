import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '@video-books/cache';
import { parseChapterFile } from '@video-books/chapter-parser';
import type { FfprobeOutput } from '@video-books/assembler';
import { runRender, type RenderDeps } from './render.js';

const FIXTURE_PATH = new URL('../../../content/chapters/fixture.spec.json', import.meta.url)
  .pathname;

function bufferLogger(): {
  logger: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    logger: {
      log: (...args) => out.push(args.map(String).join(' ')),
      error: (...args) => err.push(args.map(String).join(' ')),
    },
  };
}

function makeProbe(durationSec: number): FfprobeOutput {
  return {
    format: { duration: durationSec.toFixed(3) },
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
  };
}

function makeDeps(
  cacheRoot: string,
  expectedSec: number,
  recorded: { ffmpegArgs: string[][]; ffprobePaths: string[] },
): RenderDeps {
  const { logger } = bufferLogger();
  return {
    cache: createCache(cacheRoot),
    imageClient: {
      generate: vi.fn(async () => ({ image: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })),
    },
    videoClient: { generate: vi.fn(async () => ({ video: new Uint8Array([0x00, 0x00, 0x00]) })) },
    narrationClient: { generate: vi.fn(async () => ({ audio: new Uint8Array([0xff, 0xfb]) })) },
    pickProvider: (s) => (s.type === 'HERO' ? 'veo' : 'kling'),
    styleAnchor: 'wilderness oil painting',
    imageProvider: 'midjourney',
    imageModel: 'v7',
    narrationVoiceId: 'voice-1',
    narrationModel: 'eleven_v2',
    runFfmpeg: vi.fn(async (args: string[]) => {
      recorded.ffmpegArgs.push(args);
      // Pretend ffmpeg succeeded — we're testing wiring, not encoding.
      return { code: 0, stderr: '' };
    }),
    ffprobe: vi.fn(async (path: string) => {
      recorded.ffprobePaths.push(path);
      return makeProbe(expectedSec);
    }),
    logger,
  };
}

describe('runRender (e2e wiring with mock providers)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcap-render-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('drives orchestrator → timeline → ffmpeg → verify against the 3-scene fixture', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const outputPath = join(dir, 'fixture.mp4');
    // With xfadeSec=0 the clip duration is ceil(audio + 0) = authored sum.
    const expectedSec = spec.scenes.reduce(
      (s, sc) => s + sc.beats.reduce((b, beat) => b + beat.sec, 0),
      0,
    );
    const deps = makeDeps(dir, expectedSec, recorded);

    const result = await runRender(spec, deps, {
      outputPath,
      maxCostUsd: 100,
      confirm: false,
      xfadeSec: 0,
    });

    // Cost preflight:
    expect(result.cost.imageCount).toBe(3);
    expect(result.cost.totalUsd).toBeGreaterThan(0);

    // Orchestrator generated everything (cold cache):
    expect(deps.imageClient.generate).toHaveBeenCalledTimes(3);
    expect(deps.videoClient.generate).toHaveBeenCalledTimes(3);
    expect(deps.narrationClient.generate).toHaveBeenCalledTimes(5);

    // Timeline reflects fixture durations end-to-end:
    expect(result.timeline.totalDurationSec).toBe(expectedSec);
    expect(result.timeline.scenes).toHaveLength(3);

    // ffmpeg invoked exactly once with our output path:
    expect(recorded.ffmpegArgs).toHaveLength(1);
    expect(recorded.ffmpegArgs[0]?.at(-1)).toBe(outputPath);

    // ffprobe verification:
    expect(recorded.ffprobePaths).toEqual([outputPath]);
    expect(result.verify?.ok).toBe(true);
  });

  it('refuses to render when cost exceeds maxCostUsd without --confirm', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const deps = makeDeps(dir, 1, recorded);

    await expect(
      runRender(spec, deps, {
        outputPath: join(dir, 'x.mp4'),
        maxCostUsd: 0.01,
        confirm: false,
      }),
    ).rejects.toThrow(/exceeds --max-cost/);

    expect(deps.imageClient.generate).not.toHaveBeenCalled();
    expect(recorded.ffmpegArgs).toHaveLength(0);
  });

  it('proceeds when cost exceeds maxCostUsd and --confirm is set', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const expectedSec = spec.scenes.reduce(
      (s, sc) => s + sc.beats.reduce((b, beat) => b + beat.sec, 0),
      0,
    );
    const deps = makeDeps(dir, expectedSec, recorded);

    const result = await runRender(spec, deps, {
      outputPath: join(dir, 'x.mp4'),
      maxCostUsd: 0.01,
      confirm: true,
      xfadeSec: 0,
    });
    expect(result.verify?.ok).toBe(true);
  });

  it('throws when ffmpeg returns non-zero', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const deps = makeDeps(dir, 1, recorded);
    deps.runFfmpeg = vi.fn(async () => ({ code: 1, stderr: 'simulated boom' }));

    await expect(
      runRender(spec, deps, {
        outputPath: join(dir, 'x.mp4'),
        maxCostUsd: 100,
        confirm: false,
      }),
    ).rejects.toThrow(/simulated boom/);
  });

  it('throws when verifyOutput fails', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const expectedSec = spec.scenes.reduce(
      (s, sc) => s + sc.beats.reduce((b, beat) => b + beat.sec, 0),
      0,
    );
    const deps = makeDeps(dir, expectedSec, recorded);
    // Swap probe to return a wildly off duration
    deps.ffprobe = vi.fn(
      async (): Promise<FfprobeOutput> => ({
        format: { duration: '999' },
        streams: [
          { index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' },
          { index: 1, codec_type: 'audio', codec_name: 'aac' },
        ],
      }),
    );

    await expect(
      runRender(spec, deps, {
        outputPath: join(dir, 'x.mp4'),
        maxCostUsd: 100,
        confirm: false,
      }),
    ).rejects.toThrow(/verification failed/);
  });

  it('caches across runs — second run hits cache for everything', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const expectedSec = spec.scenes.reduce(
      (s, sc) => s + sc.beats.reduce((b, beat) => b + beat.sec, 0),
      0,
    );
    const deps1 = makeDeps(dir, expectedSec, recorded);
    await runRender(spec, deps1, {
      outputPath: join(dir, 'a.mp4'),
      maxCostUsd: 100,
      confirm: false,
      xfadeSec: 0,
    });

    const deps2 = makeDeps(dir, expectedSec, recorded);
    await runRender(spec, deps2, {
      outputPath: join(dir, 'b.mp4'),
      maxCostUsd: 100,
      confirm: false,
      xfadeSec: 0,
    });

    expect(deps2.imageClient.generate).not.toHaveBeenCalled();
    expect(deps2.videoClient.generate).not.toHaveBeenCalled();
    expect(deps2.narrationClient.generate).not.toHaveBeenCalled();
  });

  it('default xfadeSec=1.5 expands clip durations with padding (verify-expected accounts for fade overlap)', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    // Fixture beats sum to 14, 7, 14 = 35s of authored audio.
    // With xfadeSec=1.5 padding:
    //   ceil(14+1.5)=16, ceil(7+1.5)=9, ceil(14+1.5)=16 → video stream = 38s
    //   audio stream (no probe injected, falls back to authored) = 35s
    //   expectedOutputSec = min(38, 35) = 35  (ffmpeg -shortest trims to audio)
    const expectedSec = 35;
    const deps = makeDeps(dir, expectedSec, recorded);

    const result = await runRender(spec, deps, {
      outputPath: join(dir, 'fixture.mp4'),
      maxCostUsd: 100,
      confirm: false,
    });

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => (c[0] as { durationSec: number }).durationSec)).toEqual([16, 9, 16]);
    expect(result.verify?.ok).toBe(true);
  });

  it('expectedOutputSec uses min(video stream, audio stream) so audio-shorter renders verify', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    // Stub probeAudioDurationSec so audio is much shorter than authored.
    // With ~3s per beat across 5 beats: audio ≈ 15s. Video stream ≈ 38s.
    // expectedOutputSec should be min(38, 15) = 15. ffprobe stub returns 15.
    const deps = makeDeps(dir, 15, recorded);
    deps.probeAudioDurationSec = async () => 3;

    const result = await runRender(spec, deps, {
      outputPath: join(dir, 'fixture.mp4'),
      maxCostUsd: 100,
      confirm: false,
    });

    expect(result.verify?.ok).toBe(true);
  });

  it('per-scene output: emits one ffmpeg invocation per scene with sortable filenames', async () => {
    const spec = await parseChapterFile(FIXTURE_PATH);
    const recorded = { ffmpegArgs: [] as string[][], ffprobePaths: [] as string[] };
    const expectedSec = spec.scenes.reduce(
      (s, sc) => s + sc.beats.reduce((b, beat) => b + beat.sec, 0),
      0,
    );
    const deps = makeDeps(dir, expectedSec, recorded);
    const perSceneOutputDir = join(dir, 'per-scene');

    const result = await runRender(spec, deps, {
      outputPath: join(dir, 'unused.mp4'),
      maxCostUsd: 100,
      confirm: false,
      perSceneOutputDir,
    });

    // One ffmpeg call per scene (no master concat pass):
    expect(recorded.ffmpegArgs).toHaveLength(spec.scenes.length);
    // ffprobe is NOT called in per-scene mode (no master to verify):
    expect(recorded.ffprobePaths).toEqual([]);
    expect(result.verify).toBeNull();

    // Per-scene paths use 3-digit zero-padded scene numbers and the spec slug:
    expect(result.perSceneOutputPaths).toHaveLength(spec.scenes.length);
    for (let i = 0; i < spec.scenes.length; i += 1) {
      const scene = spec.scenes[i];
      if (scene === undefined) continue;
      const expectedFilename = `${spec.slug}-scene-${scene.n.toString().padStart(3, '0')}.mp4`;
      expect(result.perSceneOutputPaths[i]).toBe(join(perSceneOutputDir, expectedFilename));
    }

    // Without padding, clips are sized to ceil(authored_sec) — no +1.5s tail:
    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    const requestedSecs = calls.map((c) => (c[0] as { durationSec: number }).durationSec);
    const authoredSecsPerScene = spec.scenes.map((s) =>
      Math.ceil(s.beats.reduce((b, beat) => b + beat.sec, 0)),
    );
    expect(requestedSecs).toEqual(authoredSecsPerScene);
  });
});
