# @video-books/cli

The `wcap` command. Architecture §4 / Phase 1 task #9.

## Subcommands

| Command    | Purpose                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `validate` | Parse and validate a chapter spec (no API calls).                                                                                        |
| `cost`     | Pre-flight cost estimate per architecture §6.2 / §10 (no API calls).                                                                     |
| `render`   | Full pipeline: generate stills + clips + narration, build timeline, ffmpeg → MP4. **Stubbed in this PR; wired in PR #10 (e2e fixture).** |

## Usage

```sh
pnpm --filter @video-books/cli build
node packages/cli/dist/bin.js validate content/chapters/chapter-6.spec.json
node packages/cli/dist/bin.js cost     content/chapters/chapter-6.spec.json
node packages/cli/dist/bin.js render   content/chapters/chapter-6.spec.json --max-cost 50 --confirm
```

When the package is installed, the `bin` field exposes `wcap` directly:

```sh
wcap cost content/chapters/chapter-6.spec.json
```

## Cost preflight

`estimateCost(spec, rates?)` returns `{ imageCount, imageUsd, videoSec, videoUsd, narrationChars, narrationUsd, totalUsd }`. Defaults are best-effort marginals:

| Component     | Default rate     | Source                               |
| ------------- | ---------------- | ------------------------------------ |
| Images        | $0.05 / image    | Midjourney v7 Standard plan marginal |
| Video (SCENE) | $0.07 / sec      | Kling 3.0 (architecture §3)          |
| Video (HERO)  | $0.05 / sec      | Veo 3.1 Lite (architecture §3)       |
| Narration     | $22 / 100K chars | ElevenLabs Creator (architecture §3) |

These are estimates, not invoices. Pass custom `CostRates` if your contracts differ.

## Orchestrator

Exposed for tests and downstream tools: `generateArtifacts(spec, deps)` runs the cache-or-generate loop for every still / clip / narration in a spec. All external dependencies (cache, image client, video client, narration client, provider router) are injected — no real-API smoke testing needed for unit tests.

```ts
import { generateArtifacts } from '@video-books/cli';

const artifacts = await generateArtifacts(spec, {
  cache,
  imageClient,
  videoClient,
  narrationClient,
  pickProvider,
  styleAnchor,
  imageProvider: 'midjourney',
  imageModel: 'v7',
  narrationVoiceId: 'voice-1',
  narrationModel: 'eleven_multilingual_v2',
  onProgress: (ev) => log.info(ev),
});
// artifacts → { imagePathFor, clipPathFor, audioPathFor } for the assembler
```

Cache keys mirror architecture §6.3-§6.5:

- Images: SHA256(`prompt + styleAnchor + provider + model`)
- Clips: SHA256(`imageHash + motion + provider`)
- Narration: SHA256(`text + voiceId + model`)

## Status of `render`

This PR ships argument parsing for `render` (so the CLI shape is stable) but stubs the actual rendering. PR #10 lands a 3-scene fixture in `content/chapters/` and wires the orchestrator + assembler through, with an integration test that runs end-to-end against mock providers.
