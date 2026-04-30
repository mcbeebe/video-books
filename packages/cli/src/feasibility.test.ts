import { describe, expect, it } from 'vitest';
import type { ChapterSpec } from '@video-books/types';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import { pickProvider } from '@video-books/video-gen';
import { checkClipFeasibility, formatFeasibility } from './feasibility.js';

describe('checkClipFeasibility', () => {
  it('returns ok when every scene fits its provider max', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        // SCENE → kling (max 15s); 3+4 = 7s fits
        {
          ...validScene,
          n: 1,
          type: 'SCENE',
          beats: [
            { ...validBeat, id: '1.1', sec: 3 },
            { ...validBeat, id: '1.2', sec: 4 },
          ],
        },
        // HERO → veo (max 8s); 6s fits
        { ...validScene, n: 2, type: 'HERO', beats: [{ ...validBeat, id: '2.1', sec: 6 }] },
      ],
    };
    const report = checkClipFeasibility(spec, pickProvider);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
  });

  it('flags HERO scenes whose total exceeds veo max (8s)', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          type: 'HERO',
          beats: [
            { ...validBeat, id: '1.1', sec: 8 },
            { ...validBeat, id: '1.2', sec: 6 },
          ],
        },
      ],
    };
    const report = checkClipFeasibility(spec, pickProvider);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual([
      { sceneN: 1, sceneType: 'HERO', provider: 'veo', totalSec: 14, maxSec: 8, overSec: 6 },
    ]);
  });

  it('flags SCENE scenes whose total exceeds kling max (15s)', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          type: 'SCENE',
          beats: [
            { ...validBeat, id: '1.1', sec: 10 },
            { ...validBeat, id: '1.2', sec: 8 },
          ],
        },
      ],
    };
    const report = checkClipFeasibility(spec, pickProvider);
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ provider: 'kling', totalSec: 18, overSec: 3 });
  });

  it('flags multiple bad scenes, leaves good ones alone', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        // Good — fits kling
        { ...validScene, n: 1, type: 'SCENE', beats: [{ ...validBeat, id: '1.1', sec: 5 }] },
        // Bad — over veo max
        {
          ...validScene,
          n: 2,
          type: 'HERO',
          beats: [
            { ...validBeat, id: '2.1', sec: 8 },
            { ...validBeat, id: '2.2', sec: 4 },
          ],
        },
        // Good — fits veo (8s exactly)
        { ...validScene, n: 3, type: 'HERO', beats: [{ ...validBeat, id: '3.1', sec: 8 }] },
        // Bad — over kling max
        {
          ...validScene,
          n: 4,
          type: 'SCENE',
          beats: [{ ...validBeat, id: '4.1', sec: 16 }],
        },
      ],
    };
    const report = checkClipFeasibility(spec, pickProvider);
    expect(report.issues.map((i) => i.sceneN)).toEqual([2, 4]);
  });

  it('respects a custom router that picks a different provider per scene', () => {
    // Route everything to seedance (max 15s); a 16s scene should still trip
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          type: 'HERO',
          beats: [{ ...validBeat, id: '1.1', sec: 16 }],
        },
      ],
    };
    const report = checkClipFeasibility(spec, () => 'seedance');
    expect(report.issues[0]?.provider).toBe('seedance');
    expect(report.issues[0]?.maxSec).toBe(15);
  });
});

describe('formatFeasibility', () => {
  it('renders a clean line when ok', () => {
    expect(formatFeasibility({ ok: true, issues: [] })).toMatch(/all scenes fit/);
  });

  it('renders one warning line per issue plus a footer', () => {
    const out = formatFeasibility({
      ok: false,
      issues: [
        { sceneN: 1, sceneType: 'HERO', provider: 'veo', totalSec: 14, maxSec: 8, overSec: 6 },
        { sceneN: 47, sceneType: 'SCENE', provider: 'kling', totalSec: 18, maxSec: 15, overSec: 3 },
      ],
    });
    expect(out).toMatch(/scene 1 \(HERO, veo, max 8s\): 14s — 6s over/);
    expect(out).toMatch(/scene 47 \(SCENE, kling, max 15s\): 18s — 3s over/);
    expect(out).toMatch(/2 scene\(s\) need/);
  });
});
