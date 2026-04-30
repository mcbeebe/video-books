import { describe, expect, it } from 'vitest';
import type { ChapterSpec } from '@video-books/types';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import { DEFAULT_RATES, estimateCost, formatCost } from './cost.js';

describe('estimateCost', () => {
  it('counts one image per scene', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        { ...validScene, n: 1 },
        { ...validScene, n: 2 },
        { ...validScene, n: 3 },
      ],
    };
    expect(estimateCost(spec).imageCount).toBe(3);
  });

  it('sums beat seconds across scenes for video duration', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          beats: [
            { ...validBeat, id: '1.1', sec: 5 },
            { ...validBeat, id: '1.2', sec: 7 },
          ],
        },
        { ...validScene, n: 2, beats: [{ ...validBeat, id: '2.1', sec: 10 }] },
      ],
    };
    expect(estimateCost(spec).videoSec).toBe(22);
  });

  it('uses HERO rate for HERO scenes', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        { ...validScene, n: 1, type: 'HERO', beats: [{ ...validBeat, id: '1.1', sec: 10 }] },
      ],
    };
    const c = estimateCost(spec);
    expect(c.videoUsd).toBeCloseTo(10 * DEFAULT_RATES.videoHeroUsdPerSec, 6);
  });

  it('uses SCENE rate for non-HERO scenes', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        { ...validScene, n: 1, type: 'SCENE', beats: [{ ...validBeat, id: '1.1', sec: 10 }] },
      ],
    };
    const c = estimateCost(spec);
    expect(c.videoUsd).toBeCloseTo(10 * DEFAULT_RATES.videoSceneUsdPerSec, 6);
  });

  it('counts narration characters from beat text', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [
        {
          ...validScene,
          n: 1,
          beats: [
            { ...validBeat, id: '1.1', sec: 5, text: 'hello' }, // 5 chars
            { ...validBeat, id: '1.2', sec: 5, text: 'wilderness world' }, // 16 chars
          ],
        },
      ],
    };
    expect(estimateCost(spec).narrationChars).toBe(21);
  });

  it('totalUsd is the sum of components', () => {
    const c = estimateCost(validChapterSpec);
    expect(c.totalUsd).toBeCloseTo(c.imageUsd + c.videoUsd + c.narrationUsd, 6);
  });

  it('honors custom rates', () => {
    const spec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [{ ...validScene, n: 1, beats: [{ ...validBeat, id: '1.1', sec: 10 }] }],
    };
    const c = estimateCost(spec, {
      imageUsd: 1,
      videoSceneUsdPerSec: 2,
      videoHeroUsdPerSec: 3,
      narrationUsdPerChar: 0.01,
    });
    expect(c.imageUsd).toBe(1);
    expect(c.videoUsd).toBe(20); // 10s × $2
  });
});

describe('formatCost', () => {
  it('renders a stable, human-readable summary', () => {
    const out = formatCost(estimateCost(validChapterSpec));
    expect(out).toMatch(/Images:/);
    expect(out).toMatch(/Video:/);
    expect(out).toMatch(/Narration:/);
    expect(out).toMatch(/Total:/);
    expect(out).toMatch(/\$\d+\.\d{2}/);
  });
});
