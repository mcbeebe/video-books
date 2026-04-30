import type { Beat, ChapterSpec, Scene } from './chapter.js';

/**
 * A minimal valid `Beat`. Use as a building block in tests; override fields
 * via spread when you want to test variations.
 */
export const validBeat: Beat = {
  id: '1.1',
  sec: 8,
  text: 'A clear cold morning on the meadow.',
};

/**
 * A minimal valid `Scene` — `SCENE` type with one beat.
 */
export const validScene: Scene = {
  n: 1,
  type: 'SCENE',
  day: 'Day 1',
  image: 'High-altitude meadow at dawn, soft mist, distant peaks.',
  motion: 'slow push-in',
  beats: [validBeat],
};

/**
 * A minimal valid `ChapterSpec` — single scene, single beat. Sufficient for
 * schema-shape tests; integration tests use richer fixtures.
 */
export const validChapterSpec: ChapterSpec = {
  slug: 'sample-chapter',
  title: 'Sample Chapter',
  source: 'https://www.gutenberg.org/files/32540/32540-h/32540-h.htm',
  styleAnchor: 'content/style-anchors/wilderness-v1.txt',
  scenes: [validScene],
  output: { width: 1920, height: 1080, fps: 30 },
};
