import { describe, expect, it } from 'vitest';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import type { ChapterSpec } from '@video-books/types';
import { buildFfmpegArgs } from './filtergraph.js';
import { buildTimeline } from './timeline.js';

const artifacts = {
  clipPathsFor: (s: { n: number }) => [`cache/clips/${s.n.toString()}.mp4`],
  audioPathFor: (b: { id: string }) => `cache/audio/${b.id}.mp3`,
};

const threeSceneSpec: ChapterSpec = {
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

describe('buildFfmpegArgs', () => {
  it('declares one -i per clip and one per beat audio', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    const inputCount = args.filter((a) => a === '-i').length;
    expect(inputCount).toBe(3 + 4); // 3 clips + 4 beats
  });

  it('builds per-scene video streams then concats them', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    // Each scene → one normalized stream label [sNv]; then concat all scenes.
    expect(filterGraph).toContain('[s0v][s1v][s2v]concat=n=3:v=1:a=0[v]');
  });

  it('builds a narration concat starting at the right input index', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    // 3 clips → narration audio inputs start at index 3
    expect(filterGraph).toContain('[3:a][4:a][5:a][6:a]concat=n=4:v=0:a=1[narr]');
  });

  it('omits ambient mix when ambientBedPath is null', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph, args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    expect(filterGraph).not.toContain('amix');
    // -map '[narr]' instead of '[a]'
    expect(args[args.indexOf('-map') + 3]).toBe('[narr]');
  });

  it('adds amix and volume filter when ambient bed present', () => {
    const tl = buildTimeline(threeSceneSpec, {
      ...artifacts,
      ambientBedPath: 'content/ambient/forest.mp3',
    });
    const { filterGraph, args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    expect(filterGraph).toContain('volume=-18dB[amb]');
    expect(filterGraph).toContain('[narr][amb]amix=inputs=2');
    // last input is the ambient bed
    expect(args).toContain('-stream_loop');
    expect(args[args.indexOf('-map') + 3]).toBe('[a]');
  });

  it('honors ambientBedDb override', () => {
    const tl = buildTimeline(threeSceneSpec, {
      ...artifacts,
      ambientBedPath: 'content/ambient/forest.mp3',
    });
    const { filterGraph } = buildFfmpegArgs(tl, {
      outputPath: '/tmp/out.mp4',
      ambientBedDb: -24,
    });
    expect(filterGraph).toContain('volume=-24dB');
  });

  it('emits H.264 yuv420p with +faststart', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    expect(args).toContain('libx264');
    expect(args).toContain('yuv420p');
    expect(args).toContain('+faststart');
  });

  it('writes to the requested output path', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { args, outputPath } = buildFfmpegArgs(tl, { outputPath: '/some/where/x.mp4' });
    expect(outputPath).toBe('/some/where/x.mp4');
    expect(args.at(-1)).toBe('/some/where/x.mp4');
  });

  it('passes -y so re-runs overwrite the previous output', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    expect(args[0]).toBe('-y');
  });

  it('passes the timeline fps as -r', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { args } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    const idx = args.indexOf('-r');
    expect(args[idx + 1]).toBe('30');
  });

  it('uses xfade chain across scenes when xfadeSec > 0 (one clip per scene)', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph, args } = buildFfmpegArgs(tl, {
      outputPath: '/tmp/out.mp4',
      xfadeSec: 0.5,
      // scene durations from threeSceneSpec: 5, 15, 4
      clipDurationsSec: [[5], [15], [4]],
    });
    // Single sub-clip per scene → just normalize, label as scene stream
    expect(filterGraph).toContain('[0:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s0v]');
    expect(filterGraph).toContain('[1:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s1v]');
    expect(filterGraph).toContain('[2:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s2v]');
    // First xfade: between s0v and s1v, offset = 5 - 0.5 = 4.500
    expect(filterGraph).toContain('[s0v][s1v]xfade=transition=fade:duration=0.5:offset=4.500[xs1]');
    // Second xfade: between xs1 and s2v, offset = (5 + 15) - 2 * 0.5 = 19.000
    expect(filterGraph).toContain('[xs1][s2v]xfade=transition=fade:duration=0.5:offset=19.000[v]');
    expect(args[args.indexOf('-map') + 1]).toBe('[v]');
  });

  it('multi-clip-per-scene: concats sub-clips inside the scene with no fade, xfades only between scenes', () => {
    // Override the timeline's clipPaths: scene 1 has 2 sub-clips, scene 2 has 1, scene 3 has 2.
    const tl = buildTimeline(threeSceneSpec, {
      clipPathsFor: (s) => {
        if (s.n === 1) return ['cache/clips/1a.mp4', 'cache/clips/1b.mp4'];
        if (s.n === 3) return ['cache/clips/3a.mp4', 'cache/clips/3b.mp4'];
        return ['cache/clips/2.mp4'];
      },
      audioPathFor: (b) => `cache/audio/${b.id}.mp3`,
    });
    const { filterGraph, args } = buildFfmpegArgs(tl, {
      outputPath: '/tmp/out.mp4',
      xfadeSec: 1.0,
      // Per scene durations: scene 1 = 8 + 7 = 15, scene 2 = 7, scene 3 = 6 + 4 = 10
      clipDurationsSec: [[8, 7], [7], [6, 4]],
    });

    // Scene 1: 2 sub-clips concat'd (no fade), labeled s0v
    expect(filterGraph).toContain(
      '[0:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s0c0]',
    );
    expect(filterGraph).toContain(
      '[1:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s0c1]',
    );
    expect(filterGraph).toContain('[s0c0][s0c1]concat=n=2:v=1:a=0[s0v]');

    // Scene 2: single clip, normalized
    expect(filterGraph).toContain('[2:v]fps=30,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[s1v]');

    // Scene 3: 2 sub-clips concat'd
    expect(filterGraph).toContain('[s2c0][s2c1]concat=n=2:v=1:a=0[s2v]');

    // Scene-level xfade: scene 1 (15s) → scene 2 → scene 3
    // First xfade offset = 15 - 1 = 14.000
    expect(filterGraph).toContain('[s0v][s1v]xfade=transition=fade:duration=1:offset=14.000[xs1]');
    // Second xfade offset = 15 + 7 - 2 = 20.000
    expect(filterGraph).toContain('[xs1][s2v]xfade=transition=fade:duration=1:offset=20.000[v]');

    // Audio inputs start AFTER all 5 sub-clip inputs (0..4)
    expect(filterGraph).toContain('[5:a][6:a][7:a][8:a]concat=n=4:v=0:a=1[narr]');

    expect(args[args.indexOf('-map') + 1]).toBe('[v]');
  });

  it('falls back to plain concat when xfadeSec is 0', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4', xfadeSec: 0 });
    expect(filterGraph).toContain('[s0v][s1v][s2v]concat=n=3:v=1:a=0[v]');
    expect(filterGraph).not.toContain('xfade');
  });

  it('falls back to plain concat when only one scene (xfade impossible)', () => {
    const oneSceneSpec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [{ ...validScene, n: 1, beats: [{ ...validBeat, id: '1.1', sec: 5 }] }],
    };
    const tl = buildTimeline(oneSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4', xfadeSec: 0.5 });
    expect(filterGraph).toContain('[s0v]concat=n=1:v=1:a=0[v]');
    expect(filterGraph).not.toContain('xfade');
  });
});
