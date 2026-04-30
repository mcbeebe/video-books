import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCache } from '@video-books/cache';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import type { ChapterSpec } from '@video-books/types';
import { generateArtifacts, type OrchestratorDeps, type ProgressEvent } from './orchestrator.js';

function makeDeps(
  events: ProgressEvent[],
  cacheRoot: string,
  overrides: Partial<OrchestratorDeps> = {},
): OrchestratorDeps {
  return {
    cache: createCache(cacheRoot),
    imageClient: { generate: vi.fn(async () => ({ image: new Uint8Array([1, 2, 3]) })) },
    videoClient: {
      generate: vi.fn(async () => ({ video: new Uint8Array([4, 5, 6]) })),
    },
    narrationClient: {
      generate: vi.fn(async () => ({ audio: new Uint8Array([7, 8, 9]) })),
    },
    pickProvider: () => 'kling',
    styleAnchor: 'wilderness oil painting',
    imageProvider: 'midjourney',
    imageModel: 'v7',
    narrationVoiceId: 'voice-1',
    narrationModel: 'eleven_v2',
    onProgress: (ev) => events.push(ev),
    ...overrides,
  };
}

// Each scene must have a unique image prompt + unique beat text so cache
// keys differ — otherwise the orchestrator (correctly) reports cache hits
// across scenes that happen to share inputs.
const threeSceneSpec: ChapterSpec = {
  ...validChapterSpec,
  scenes: [
    {
      ...validScene,
      n: 1,
      type: 'SCENE',
      image: 'scene one image prompt — high meadow at dawn',
      beats: [{ ...validBeat, id: '1.1', sec: 5, text: 'scene one narration' }],
    },
    {
      ...validScene,
      n: 2,
      type: 'HERO',
      image: 'scene two image prompt — alpine lake at noon',
      beats: [
        { ...validBeat, id: '2.1', sec: 7, text: 'scene two beat one narration' },
        { ...validBeat, id: '2.2', sec: 4, text: 'scene two beat two narration' },
      ],
    },
  ],
};

describe('generateArtifacts', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcap-orch-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('generates each artifact once on a cold cache', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir);
    await generateArtifacts(threeSceneSpec, deps);

    expect(deps.imageClient.generate).toHaveBeenCalledTimes(2);
    expect(deps.videoClient.generate).toHaveBeenCalledTimes(2);
    expect(deps.narrationClient.generate).toHaveBeenCalledTimes(3);
    expect(events.filter((e) => 'cached' in e && !e.cached)).toHaveLength(7);
  });

  it('skips generation when artifacts are already cached', async () => {
    const events1: ProgressEvent[] = [];
    const deps1 = makeDeps(events1, dir);
    await generateArtifacts(threeSceneSpec, deps1);

    const events2: ProgressEvent[] = [];
    const deps2 = makeDeps(events2, dir);
    await generateArtifacts(threeSceneSpec, deps2);

    expect(deps2.imageClient.generate).not.toHaveBeenCalled();
    expect(deps2.videoClient.generate).not.toHaveBeenCalled();
    expect(deps2.narrationClient.generate).not.toHaveBeenCalled();
    expect(events2.every((e) => 'cached' in e && e.cached)).toBe(true);
  });

  it('passes the routed provider to the video client', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, {
      pickProvider: (s) => (s.type === 'HERO' ? 'veo' : 'kling'),
    });
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.map((c) => (c[0] as { provider: string }).provider)).toEqual(['kling', 'veo']);
  });

  it('passes scene total beat duration as the requested clip durationSec', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir);
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    // threeSceneSpec scene 1 = 5s (one beat), scene 2 = 7+4 = 11s
    expect(calls.map((c) => (c[0] as { durationSec: number }).durationSec)).toEqual([5, 11]);
  });

  it('uses probeAudioDurationSec to size video clips when injected', async () => {
    const events: ProgressEvent[] = [];
    // Stub probe: pretend every audio file is 3.5s long, regardless of authored beat.sec.
    const deps = makeDeps(events, dir, {
      probeAudioDurationSec: async () => 3.5,
    });
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    // scene 1 = 1 beat × 3.5 = 3.5s; scene 2 = 2 beats × 3.5 = 7s
    expect(calls.map((c) => (c[0] as { durationSec: number }).durationSec)).toEqual([3.5, 7]);
  });

  it('Artifacts.audioDurationSecFor and clipDurationSecFor return measured values', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, {
      probeAudioDurationSec: async () => 4.2,
    });
    const artifacts = await generateArtifacts(threeSceneSpec, deps);

    const beat11 = threeSceneSpec.scenes[0]!.beats[0]!;
    expect(artifacts.audioDurationSecFor(beat11)).toBe(4.2);

    const scene2 = threeSceneSpec.scenes[1]!;
    expect(artifacts.clipDurationSecFor(scene2)).toBe(8.4); // 2 beats × 4.2
  });

  it('falls back to authored beat.sec when probeAudioDurationSec is omitted', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir); // no probe
    const artifacts = await generateArtifacts(threeSceneSpec, deps);

    const beat21 = threeSceneSpec.scenes[1]!.beats[0]!;
    expect(artifacts.audioDurationSecFor(beat21)).toBe(7); // authored sec
    expect(artifacts.clipDurationSecFor(threeSceneSpec.scenes[1]!)).toBe(11); // 7 + 4
  });

  it('clip cache key changes when scene beat duration changes', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir);
    const artifacts1 = await generateArtifacts(threeSceneSpec, deps);

    // Same image prompt + motion + provider, but different total beat seconds → different key.
    const longerSpec = {
      ...threeSceneSpec,
      scenes: [
        {
          ...threeSceneSpec.scenes[0]!,
          beats: [{ ...threeSceneSpec.scenes[0]!.beats[0]!, sec: 9 }], // was 5
        },
        threeSceneSpec.scenes[1]!,
      ],
    };
    const events2: ProgressEvent[] = [];
    const deps2 = makeDeps(events2, dir);
    const artifacts2 = await generateArtifacts(longerSpec, deps2);

    const sceneA = threeSceneSpec.scenes[0]!;
    const sceneB = longerSpec.scenes[0]!;
    expect(artifacts1.clipPathFor(sceneA)).not.toBe(artifacts2.clipPathFor(sceneB));
  });

  it('appends styleAnchor to the image prompt', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir);
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.imageClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    for (const call of calls) {
      expect(call[0]).toMatch(/wilderness oil painting$/);
    }
  });

  it('returns artifact path lookups that match the cache layout', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir);
    const artifacts = await generateArtifacts(threeSceneSpec, deps);

    const scene1 = threeSceneSpec.scenes[0];
    if (!scene1) throw new Error('expected scene');
    expect(artifacts.imagePathFor(scene1)).toMatch(/\/images\/[0-9a-f]{64}\.png$/);
    expect(artifacts.clipPathFor(scene1)).toMatch(/\/clips\/[0-9a-f]{64}\.mp4$/);
    const beat1 = scene1.beats[0];
    if (!beat1) throw new Error('expected beat');
    expect(artifacts.audioPathFor(beat1)).toMatch(/\/audio\/[0-9a-f]{64}\.mp3$/);
  });

  it('cache hits and misses interleave correctly when partial', async () => {
    // First run generates everything for scene 1. Then we re-run with both scenes;
    // scene 1 should be cached, scene 2 freshly generated.
    const events1: ProgressEvent[] = [];
    const deps1 = makeDeps(events1, dir);
    const partialSpec: ChapterSpec = {
      ...threeSceneSpec,
      scenes: [threeSceneSpec.scenes[0]!],
    };
    await generateArtifacts(partialSpec, deps1);

    const events2: ProgressEvent[] = [];
    const deps2 = makeDeps(events2, dir);
    await generateArtifacts(threeSceneSpec, deps2);

    expect(deps2.imageClient.generate).toHaveBeenCalledTimes(1); // only scene 2
    expect(deps2.videoClient.generate).toHaveBeenCalledTimes(1);
    expect(deps2.narrationClient.generate).toHaveBeenCalledTimes(2); // scene 2's two beats
  });
});
