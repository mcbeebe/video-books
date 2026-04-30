# @video-books/assembler

FFmpeg orchestration for the WCAP render pipeline. Architecture §6.6-§6.8.

Three layers:

1. **Timeline** (`buildTimeline`) — pure: takes a `ChapterSpec` + artifact paths, returns a JSON-serialisable `Timeline` with absolute start/end times for every scene + beat.
2. **Filter graph** (`buildFfmpegArgs`) — pure: takes a `Timeline`, returns the FFmpeg command-line args (no shell escaping, just an array).
3. **Process** (`runFfmpeg`, `ffprobe`, `verifyOutput`) — thin `node:child_process` wrappers + a pure `verifyOutput` that asserts the rendered MP4 matches §6.8 requirements (duration ±2s, h264, yuv420p, audio present).

## Usage

```ts
import {
  buildTimeline,
  buildFfmpegArgs,
  runFfmpeg,
  ffprobe,
  verifyOutput,
} from '@video-books/assembler';

const timeline = buildTimeline(spec, {
  clipPathFor: (s) => cache.pathFor('clips', clipKey(s), 'mp4'),
  audioPathFor: (b) => cache.pathFor('audio', beatKey(b), 'mp3'),
  ambientBedPath: spec.ambientBed ?? null,
});

const { args, outputPath } = buildFfmpegArgs(timeline, {
  outputPath: `output/${spec.slug}.mp4`,
});

const { code, stderr } = await runFfmpeg(args, {
  onStderr: (chunk) => process.stderr.write(chunk),
});
if (code !== 0) throw new Error(`ffmpeg exit ${code}: ${stderr}`);

const probe = await ffprobe(outputPath);
const verify = verifyOutput(probe, { expectedDurationSec: timeline.totalDurationSec });
if (!verify.ok) throw new Error(`verification failed: ${verify.problems.join('; ')}`);
```

## Filter graph (current v1)

For N clips and M beats:

```
[0:v][1:v]…[N-1:v] concat=n=N:v=1:a=0[v];
[N:a][N+1:a]…[N+M-1:a] concat=n=M:v=0:a=1[narr];
                                                       # (if ambient bed:)
[N+M:a] volume=-18dB[amb];
[narr][amb] amix=inputs=2:duration=first:dropout_transition=0[a]
```

Then encoded with `libx264` (preset slow, CRF 18), pixel format `yuv420p`, `+faststart`, AAC 192k. `-shortest` so the output ends with the narration even if the ambient loop is longer.

**Not yet implemented** (architecture §6.7 mentions but v1 skips):

- Crossfades between scenes (`xfade=transition=fade:duration=0.5`). Adds noticeable complexity to the filter graph; defer until the simple concat shows seams.

## Testing

```sh
pnpm --filter @video-books/assembler test
```

- **Pure tests** (timeline + filter graph + verifyOutput) run anywhere.
- **Integration tests** (`runFfmpeg` + `ffprobe`) auto-skip if `ffmpeg` isn't on `$PATH`. CI runners (`ubuntu-latest`) include both, so CI exercises the real binaries against a synthetic 1-second clip.

To enable locally on macOS:

```sh
brew install ffmpeg
```
