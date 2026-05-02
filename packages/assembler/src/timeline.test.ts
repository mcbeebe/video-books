import { describe, expect, it } from 'vitest';
import type { ChapterSpec } from '@video-books/types';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import { buildTimeline } from './timeline.js';

const artifacts = {
  clipPathsFor: (s: { n: number }) => [`cache/clips/${s.n.toString()}.mp4`],
  audioPathFor: (b: { id: string }) => `cache/audio/${b.id}.mp3`,
};

describe('buildTimeline', () => {
  it('places a single scene starting at 0', () => {
    const tl = buildTimeline(validChapterSpec, artifacts);
    expect(tl.scenes).toHaveLength(1);
    const scene0 = tl.scenes[0];
    if (!scene0) throw new Error('expected scene');
    expect(scene0.startSec).toBe(0);
    expect(scene0.endSec).toBe(validBeat.sec);
    expect(scene0.durationSec).toBe(validBeat.sec);
    expect(tl.totalDurationSec).toBe(validBeat.sec);
  });

  it('chains scenes end-to-end (no overlap, no gap)', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        { ...validScene, n: 1, beats: [{ ...validBeat, id: '1.1', sec: 5 }] },
        {
          ...validScene,
          n: 2,
          beats: [
            { ...validBeat, id: '2.1', sec: 7 },
            { ...validBeat, id: '2.2', sec: 8 },
          ],
        },
        { ...validScene, n: 3, beats: [{ ...validBeat, id: '3.1', sec: 4 }] },
      ],
    };
    const tl = buildTimeline(spec, artifacts);
    expect(tl.scenes.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 5],
      [5, 20],
      [20, 24],
    ]);
    expect(tl.totalDurationSec).toBe(24);
  });

  it('beat times are absolute and contiguous within a scene', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          beats: [
            { ...validBeat, id: '1.1', sec: 5 },
            { ...validBeat, id: '1.2', sec: 7 },
            { ...validBeat, id: '1.3', sec: 4 },
          ],
        },
      ],
    };
    const tl = buildTimeline(spec, artifacts);
    const scene0 = tl.scenes[0];
    if (!scene0) throw new Error('expected scene');
    expect(scene0.beats.map((b) => [b.startSec, b.endSec])).toEqual([
      [0, 5],
      [5, 12],
      [12, 16],
    ]);
  });

  it('scene durationSec equals the sum of its beat durations', () => {
    const tl = buildTimeline(validChapterSpec, artifacts);
    for (const scene of tl.scenes) {
      const sumOfBeats = scene.beats.reduce((sum, b) => sum + b.durationSec, 0);
      expect(scene.durationSec).toBe(sumOfBeats);
    }
  });

  it('uses provided artifact paths', () => {
    const tl = buildTimeline(validChapterSpec, {
      clipPathsFor: () => ['/abs/clip.mp4'],
      audioPathFor: () => '/abs/beat.mp3',
    });
    const scene0 = tl.scenes[0];
    if (!scene0) throw new Error('expected scene');
    expect(scene0.clipPaths).toEqual(['/abs/clip.mp4']);
    expect(scene0.beats[0]?.audioPath).toBe('/abs/beat.mp3');
  });

  it('passes through output dimensions and ambientBedPath', () => {
    const tl = buildTimeline(validChapterSpec, {
      ...artifacts,
      ambientBedPath: 'content/ambient/forest.mp3',
    });
    expect(tl.output).toEqual({ width: 1920, height: 1080, fps: 30 });
    expect(tl.ambientBedPath).toBe('content/ambient/forest.mp3');
  });

  it('ambientBedPath defaults to null when not provided', () => {
    const tl = buildTimeline(validChapterSpec, artifacts);
    expect(tl.ambientBedPath).toBeNull();
  });

  it('is deterministic (round-trippable through JSON)', () => {
    const a = buildTimeline(validChapterSpec, artifacts);
    const b = buildTimeline(validChapterSpec, artifacts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('preserves slug, title, and scene metadata', () => {
    const tl = buildTimeline(validChapterSpec, artifacts);
    expect(tl.slug).toBe(validChapterSpec.slug);
    expect(tl.title).toBe(validChapterSpec.title);
    const scene0 = tl.scenes[0];
    if (!scene0) throw new Error('expected scene');
    expect(scene0.type).toBe(validScene.type);
    expect(scene0.day).toBe(validScene.day);
  });
});
