import { z } from 'zod';

/**
 * A single 5–10 second narration unit within a scene. The fundamental unit
 * the narration generator (ElevenLabs) operates on. Architecture §5.
 */
export const BeatSchema = z.object({
  /** Stable beat ID, dotted form `<scene>.<index>` (e.g. `"58.1"`). */
  id: z.string().regex(/^\d+\.\d+$/, 'Beat id must match `<scene>.<index>` (e.g. "58.1")'),
  /** Approximate duration in seconds. Bounded to keep narration cadence steady. */
  sec: z.number().int().min(3).max(20),
  /** Verbatim narration text. The TTS engine speaks exactly this string. */
  text: z.string().min(1),
});

/**
 * One visual scene — a base image used while one or more beats narrate.
 * `HERO` scenes get richer animation and longer holds (architecture §6.4).
 */
export const SceneSchema = z.object({
  /** Scene number, 1-indexed. */
  n: z.number().int().min(1),
  /** `HERO` for emphasised scenes; `SCENE` for standard. */
  type: z.enum(['HERO', 'SCENE']),
  /** Section/day label for editorial grouping (e.g. `"Day 14"`). */
  day: z.string().min(1),
  /** Image generation prompt. Style anchor is appended at gen-time, not stored here. */
  image: z.string().min(20),
  /**
   * Motion direction for the video animation pass.
   *
   * Authoring guidance (sleep / soundscape niche, kling-routed):
   * - Prefer **single-direction, single-subject** motion. Multi-subject
   *   prompts ("tilt from sky to lake", "pan from forest to ridge")
   *   tend to be interpreted as cross-fades between two shots, which
   *   breaks the continuous-motion feel sleep audiences expect.
   * - Phrase as a single continuous camera move with secondary detail:
   *     ✗ "tilt from sky to lake"
   *     ✓ "slow downward tilt over the lake, sky visible at top of frame"
   *     ✗ "pan from forest to ridge"
   *     ✓ "slow rightward pan along the ridge, forest in foreground"
   * - Lead with `slow` / `very slow` to anchor the pace.
   */
  motion: z.string().min(1),
  /** Narration beats grouped under this scene. At least one beat is required. */
  beats: z.array(BeatSchema).min(1),
});

/**
 * Top-level chapter specification — the single source of truth that drives the
 * entire render pipeline (architecture §5).
 */
export const ChapterSpecSchema = z.object({
  /** Identifier used in filenames and cache keys. Lowercase letters, digits, hyphens only. */
  slug: z.string().regex(/^[a-z0-9-]+$/, 'slug must be lowercase letters, digits, and hyphens'),
  /** Display title. */
  title: z.string().min(1),
  /** Source attribution (e.g. a Project Gutenberg URL). */
  source: z.string().url(),
  /** Path (relative to repo root) to the locked style anchor file. */
  styleAnchor: z.string().min(1),
  /** Optional path to the ambient sound bed. */
  ambientBed: z.string().optional(),
  /** Target output specs. Sensible defaults for 1080p30. */
  output: z
    .object({
      width: z.number().int().default(1920),
      height: z.number().int().default(1080),
      fps: z.number().int().default(30),
    })
    .default({ width: 1920, height: 1080, fps: 30 }),
  scenes: z.array(SceneSchema).min(1),
});

/** A single 5–10 second narration unit within a scene. */
export type Beat = z.infer<typeof BeatSchema>;
/** One visual scene — a base image used while one or more beats narrate. */
export type Scene = z.infer<typeof SceneSchema>;
/** Top-level chapter specification. */
export type ChapterSpec = z.infer<typeof ChapterSpecSchema>;
