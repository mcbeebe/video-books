import { describe, expect, it } from 'vitest';
import { BeatSchema, ChapterSpecSchema, SceneSchema } from './chapter.js';
import { validBeat, validChapterSpec, validScene } from './fixtures.js';

describe('BeatSchema', () => {
  it('accepts a valid beat', () => {
    expect(() => BeatSchema.parse(validBeat)).not.toThrow();
  });

  it.each([
    ['missing dot', '58'],
    ['trailing dot', '58.'],
    ['non-numeric segment', 'x.1'],
    ['leading dot', '.1'],
    ['letters', '58.a'],
  ])('rejects bad id (%s)', (_label, badId) => {
    expect(() => BeatSchema.parse({ ...validBeat, id: badId })).toThrow(/Beat id must match/);
  });

  it.each([
    ['below min', 2],
    ['above max', 21],
    ['non-integer', 7.5],
  ])('rejects sec %s', (_label, badSec) => {
    expect(() => BeatSchema.parse({ ...validBeat, sec: badSec })).toThrow();
  });

  it('rejects empty text', () => {
    expect(() => BeatSchema.parse({ ...validBeat, text: '' })).toThrow();
  });
});

describe('SceneSchema', () => {
  it('accepts a valid SCENE', () => {
    expect(() => SceneSchema.parse(validScene)).not.toThrow();
  });

  it('accepts a valid HERO', () => {
    expect(() => SceneSchema.parse({ ...validScene, type: 'HERO' })).not.toThrow();
  });

  it('rejects n=0', () => {
    expect(() => SceneSchema.parse({ ...validScene, n: 0 })).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() =>
      SceneSchema.parse({ ...validScene, type: 'OTHER' as unknown as 'HERO' }),
    ).toThrow();
  });

  it('rejects empty beats array', () => {
    expect(() => SceneSchema.parse({ ...validScene, beats: [] })).toThrow();
  });

  it('rejects image prompt shorter than 20 chars', () => {
    expect(() => SceneSchema.parse({ ...validScene, image: 'too short' })).toThrow();
  });

  it('rejects empty motion direction', () => {
    expect(() => SceneSchema.parse({ ...validScene, motion: '' })).toThrow();
  });
});

describe('ChapterSpecSchema', () => {
  it('accepts a valid spec', () => {
    expect(() => ChapterSpecSchema.parse(validChapterSpec)).not.toThrow();
  });

  it.each([
    ['uppercase', 'Bad-Slug'],
    ['space', 'bad slug'],
    ['underscore', 'bad_slug'],
  ])('rejects bad slug (%s)', (_label, badSlug) => {
    expect(() => ChapterSpecSchema.parse({ ...validChapterSpec, slug: badSlug })).toThrow(
      /slug must be lowercase/,
    );
  });

  it('rejects non-URL source', () => {
    expect(() => ChapterSpecSchema.parse({ ...validChapterSpec, source: 'not a url' })).toThrow();
  });

  it('rejects zero scenes', () => {
    expect(() => ChapterSpecSchema.parse({ ...validChapterSpec, scenes: [] })).toThrow();
  });

  it('applies default output (1920x1080@30) when omitted', () => {
    const { output: _omit, ...withoutOutput } = validChapterSpec;
    const parsed = ChapterSpecSchema.parse(withoutOutput);
    expect(parsed.output).toEqual({ width: 1920, height: 1080, fps: 30 });
  });

  it('applies individual output field defaults', () => {
    const parsed = ChapterSpecSchema.parse({
      ...validChapterSpec,
      output: { width: 3840, height: 2160 },
    });
    expect(parsed.output).toEqual({ width: 3840, height: 2160, fps: 30 });
  });

  it('accepts an optional ambientBed', () => {
    const parsed = ChapterSpecSchema.parse({
      ...validChapterSpec,
      ambientBed: 'content/ambient/forest-loop.mp3',
    });
    expect(parsed.ambientBed).toBe('content/ambient/forest-loop.mp3');
  });
});
