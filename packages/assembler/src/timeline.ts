import type { Beat, ChapterSpec, Scene } from '@video-books/types';

/** A timed beat — sequential narration unit with absolute start/end. */
export interface TimelineBeat {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  audioPath: string;
}

/** A timed scene — its clip starts when the previous scene's clip ended. */
export interface TimelineScene {
  n: number;
  type: Scene['type'];
  day: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  clipPath: string;
  beats: TimelineBeat[];
}

/** Output of {@link buildTimeline}. JSON-serialisable for review/diffing. */
export interface Timeline {
  slug: string;
  title: string;
  totalDurationSec: number;
  output: { width: number; height: number; fps: number };
  ambientBedPath: string | null;
  scenes: TimelineScene[];
}

/** Caller-provided artifact lookup — paths to cached PNG/MP4/MP3 files. */
export interface Artifacts {
  /** Returns the on-disk path for the cached MP4 clip belonging to scene `n`. */
  clipPathFor(scene: Scene): string;
  /** Returns the on-disk path for the cached MP3 audio belonging to beat `id`. */
  audioPathFor(beat: Beat): string;
  /** Optional ambient bed path. Null/undefined to omit. */
  ambientBedPath?: string | null;
}

/**
 * Build a deterministic, JSON-serialisable timeline from a chapter spec and
 * the on-disk artifact paths. Pure: no I/O, no Date.now, no randomness —
 * same inputs always produce identical output.
 *
 * Scene clips are placed end-to-end (no crossfade overlap; crossfade is an
 * FFmpeg-level concern handled in `buildFilterGraph`). Beat audio sums to
 * the scene's clip duration; the renderer is responsible for time-stretching
 * or padding if `sum(beats.sec) !== clip.duration`.
 *
 * @example
 *   const timeline = buildTimeline(spec, {
 *     clipPathFor: (s) => `cache/clips/${s.n}.mp4`,
 *     audioPathFor: (b) => `cache/audio/${b.id}.mp3`,
 *     ambientBedPath: spec.ambientBed ?? null,
 *   });
 *   await fs.writeFile('timeline.json', JSON.stringify(timeline, null, 2));
 */
export function buildTimeline(spec: ChapterSpec, artifacts: Artifacts): Timeline {
  let cursor = 0;
  const scenes: TimelineScene[] = spec.scenes.map((scene) => {
    let beatCursor = cursor;
    const beats: TimelineBeat[] = scene.beats.map((beat) => {
      const start = beatCursor;
      const end = beatCursor + beat.sec;
      beatCursor = end;
      return {
        id: beat.id,
        startSec: start,
        endSec: end,
        durationSec: beat.sec,
        audioPath: artifacts.audioPathFor(beat),
      };
    });
    const sceneDurationSec = beats.reduce((sum, b) => sum + b.durationSec, 0);
    const sceneStart = cursor;
    const sceneEnd = cursor + sceneDurationSec;
    cursor = sceneEnd;
    return {
      n: scene.n,
      type: scene.type,
      day: scene.day,
      startSec: sceneStart,
      endSec: sceneEnd,
      durationSec: sceneDurationSec,
      clipPath: artifacts.clipPathFor(scene),
      beats,
    };
  });

  return {
    slug: spec.slug,
    title: spec.title,
    totalDurationSec: cursor,
    output: spec.output,
    ambientBedPath: artifacts.ambientBedPath ?? null,
    scenes,
  };
}
