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

  it('uses probeAudioDurationSec to size video clips, ceil-rounded', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, { probeAudioDurationSec: async () => 3.5 });
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    // scene 1: ceil(3.5) = 4; scene 2: ceil(7.0) = 7
    expect(calls.map((c) => (c[0] as { durationSec: number }).durationSec)).toEqual([4, 7]);
  });

  it('splits long scenes into multiple sub-clips when exceeding provider max', async () => {
    const events: ProgressEvent[] = [];
    // Scene needs 30s of clip total, provider max is 12 → expect 3 sub-clips of 10s each.
    const longSceneSpec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          image: 'long scene image',
          beats: [{ ...validBeat, id: '1.1', sec: 30, text: 'long narration text' }],
        },
      ],
    };
    let frameExtractCalls = 0;
    const deps = makeDeps(events, dir, {
      providerMaxDurationSec: () => 12,
      extractLastFrame: async () => {
        frameExtractCalls += 1;
        return new Uint8Array([0xff, 0xfe, 0xfd]); // pretend last frame
      },
    });
    const artifacts = await generateArtifacts(longSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(3);
    // Each sub-clip request ≤ 12s; sum to 30s
    const durations = calls.map((c) => (c[0] as { durationSec: number }).durationSec);
    expect(durations.reduce((s, d) => s + d, 0)).toBe(30);
    expect(durations.every((d) => d <= 12)).toBe(true);

    // Frame extracted between sub-clips (not before first, not after last)
    expect(frameExtractCalls).toBe(2);

    // Artifacts surface all 3 sub-clip paths
    expect(artifacts.clipPathsFor(longSceneSpec.scenes[0]!)).toHaveLength(3);
    expect(artifacts.clipDurationsSecFor(longSceneSpec.scenes[0]!)).toEqual(durations);
  });

  it('does not split scenes that fit within the provider max', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, {
      providerMaxDurationSec: () => 15,
      extractLastFrame: async () => new Uint8Array([0]),
    });
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    // 2 scenes, each fits in one clip
    expect(calls).toHaveLength(2);
  });

  it('reuses cached sub-clips on a second run (no re-spend)', async () => {
    const events: ProgressEvent[] = [];
    const longSceneSpec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          image: 'long scene cache test',
          beats: [{ ...validBeat, id: '1.1', sec: 24, text: 'long narration cache test' }],
        },
      ],
    };
    const deps1 = makeDeps(events, dir, {
      providerMaxDurationSec: () => 10,
      extractLastFrame: async () => new Uint8Array([1, 2, 3]),
    });
    await generateArtifacts(longSceneSpec, deps1);
    const firstRunCalls = (deps1.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(firstRunCalls).toBeGreaterThan(1); // multi-clip

    const deps2 = makeDeps(events, dir, {
      providerMaxDurationSec: () => 10,
      extractLastFrame: async () => new Uint8Array([1, 2, 3]),
    });
    await generateArtifacts(longSceneSpec, deps2);
    expect(deps2.videoClient.generate).not.toHaveBeenCalled();
  });

  it('emits heartbeat events for slow external calls', async () => {
    const events: ProgressEvent[] = [];
    let videoCalls = 0;
    const deps = makeDeps(events, dir, {
      videoClient: {
        generate: vi.fn(async () => {
          videoCalls += 1;
          // First video call is slow (200ms), subsequent are instant.
          if (videoCalls === 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 200));
          }
          return { video: new Uint8Array([4, 5, 6]) };
        }),
      },
      heartbeatAfterMs: 50,
      heartbeatIntervalMs: 50,
    });

    await generateArtifacts(threeSceneSpec, deps);

    const heartbeats = events.filter((e) => e.kind === 'heartbeat');
    expect(heartbeats.length).toBeGreaterThanOrEqual(1);
    expect(heartbeats[0]?.label).toMatch(/video scene/);
    expect(heartbeats[0]?.elapsedSec).toBeGreaterThanOrEqual(0);
  });

  it('does not emit heartbeats when heartbeatAfterMs is 0', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, { heartbeatAfterMs: 0 });
    await generateArtifacts(threeSceneSpec, deps);
    expect(events.filter((e) => e.kind === 'heartbeat')).toHaveLength(0);
  });

  it('clipPaddingSec adds to measured audio before ceiling', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, {
      probeAudioDurationSec: async () => 3.5,
      clipPaddingSec: 1.5, // simulates the xfade overlap
    });
    await generateArtifacts(threeSceneSpec, deps);

    const calls = (deps.videoClient.generate as ReturnType<typeof vi.fn>).mock.calls;
    // scene 1: ceil(3.5 + 1.5) = 5; scene 2: ceil(7.0 + 1.5) = 9
    expect(calls.map((c) => (c[0] as { durationSec: number }).durationSec)).toEqual([5, 9]);
  });

  it('Artifacts.audioDurationSecFor returns measured; clipDurationsSecFor returns ceil(audio+padding)', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir, {
      probeAudioDurationSec: async () => 4.2,
      clipPaddingSec: 1.5,
    });
    const artifacts = await generateArtifacts(threeSceneSpec, deps);

    const beat11 = threeSceneSpec.scenes[0]!.beats[0]!;
    expect(artifacts.audioDurationSecFor(beat11)).toBe(4.2); // raw measured

    const scene2 = threeSceneSpec.scenes[1]!;
    // 2 beats × 4.2 = 8.4, + 1.5 padding = 9.9, ceil → 10
    expect(artifacts.clipDurationsSecFor(scene2)).toEqual([10]);
  });

  it('falls back to authored beat.sec when probeAudioDurationSec is omitted', async () => {
    const events: ProgressEvent[] = [];
    const deps = makeDeps(events, dir); // no probe, no padding
    const artifacts = await generateArtifacts(threeSceneSpec, deps);

    const beat21 = threeSceneSpec.scenes[1]!.beats[0]!;
    expect(artifacts.audioDurationSecFor(beat21)).toBe(7); // authored sec
    expect(artifacts.clipDurationsSecFor(threeSceneSpec.scenes[1]!)).toEqual([11]); // ceil(7+4+0)
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
    expect(artifacts1.clipPathsFor(sceneA)[0]).not.toBe(artifacts2.clipPathsFor(sceneB)[0]);
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
    expect(artifacts.clipPathsFor(scene1)[0]).toMatch(/\/clips\/[0-9a-f]{64}\.mp4$/);
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
