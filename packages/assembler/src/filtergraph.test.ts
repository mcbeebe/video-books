import { describe, expect, it } from 'vitest';
import { validBeat, validChapterSpec, validScene } from '@video-books/types';
import type { ChapterSpec } from '@video-books/types';
import { buildFfmpegArgs } from './filtergraph.js';
import { buildTimeline } from './timeline.js';

const artifacts = {
  clipPathFor: (s: { n: number }) => `cache/clips/${s.n.toString()}.mp4`,
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

  it('builds a video concat that references all clip indexes in order', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4' });
    expect(filterGraph).toContain('[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]');
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

  it('uses xfade chain when xfadeSec > 0', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph, args } = buildFfmpegArgs(tl, {
      outputPath: '/tmp/out.mp4',
      xfadeSec: 0.5,
      // scene durations from threeSceneSpec: 5, 15, 4
      clipDurationsSec: [5, 15, 4],
    });
    // setpts + format/fps normalization pre-pass for each clip
    expect(filterGraph).toContain('[0:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v0]');
    expect(filterGraph).toContain('[1:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v1]');
    expect(filterGraph).toContain('[2:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[v2]');
    // First xfade: between v0 and v1, offset = 5 - 0.5 = 4.500
    expect(filterGraph).toContain('[v0][v1]xfade=transition=fade:duration=0.5:offset=4.500[xv1]');
    // Second xfade: between xv1 and v2, offset = (5 + 15) - 2 * 0.5 = 19.000
    expect(filterGraph).toContain('[xv1][v2]xfade=transition=fade:duration=0.5:offset=19.000[v]');
    // Output stream still labeled [v]
    expect(args[args.indexOf('-map') + 1]).toBe('[v]');
  });

  it('falls back to plain concat when xfadeSec is 0', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4', xfadeSec: 0 });
    expect(filterGraph).toContain('concat=n=3:v=1:a=0[v]');
    expect(filterGraph).not.toContain('xfade');
  });

  it('falls back to plain concat when only one clip (xfade impossible)', () => {
    const oneSceneSpec: ChapterSpec = {
      ...validChapterSpec,
      scenes: [{ ...validScene, n: 1, beats: [{ ...validBeat, id: '1.1', sec: 5 }] }],
    };
    const tl = buildTimeline(oneSceneSpec, artifacts);
    const { filterGraph } = buildFfmpegArgs(tl, { outputPath: '/tmp/out.mp4', xfadeSec: 0.5 });
    expect(filterGraph).toContain('concat=n=1:v=1:a=0[v]');
    expect(filterGraph).not.toContain('xfade');
  });

  it('xfade uses provided clipDurationsSec, not timeline scene durations', () => {
    const tl = buildTimeline(threeSceneSpec, artifacts);
    // Override durations: pretend the actual clips are 8, 7, 11s
    const { filterGraph } = buildFfmpegArgs(tl, {
      outputPath: '/tmp/out.mp4',
      xfadeSec: 0.5,
      clipDurationsSec: [8, 7, 11],
    });
    // First fade offset = 8 - 0.5 = 7.500
    expect(filterGraph).toContain('offset=7.500[xv1]');
    // Second fade offset = 8 + 7 - 1.0 = 14.000
    expect(filterGraph).toContain('offset=14.000[v]');
  });
});
