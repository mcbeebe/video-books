# Changelog

Append one line per merged PR. CLAUDE.md treats this file as portable long-term memory across sessions.

Format: `YYYY-MM-DD <kind>(<scope>): <summary> (#<pr>)`. Kinds match the conventional-commit prefixes enforced by commitlint.

## Unreleased

- 2026-04-29 chore: bootstrap monorepo skeleton — pnpm workspace, tsconfig, ESLint, Vitest, Prettier, commitlint, GitHub Actions CI on push + PR (no PR — initial commit, [6a14716](https://github.com/mcbeebe/video-books/commit/6a14716))
- 2026-04-29 docs: add CI badge to README ([#1](https://github.com/mcbeebe/video-books/pull/1))
- 2026-04-29 feat(types): add Zod schemas + TS types for `Beat`, `Scene`, `ChapterSpec` (architecture §5); retire `packages/hello` placeholder ([#2](https://github.com/mcbeebe/video-books/pull/2))
- 2026-04-29 feat(chapter-parser): read + validate chapter spec JSON via `parseChapterFile` / `validateSpec` (architecture §6.1) ([#3](https://github.com/mcbeebe/video-books/pull/3))
- 2026-04-29 feat(cache): content-addressable filesystem cache via `createCache` / `deriveKey` — atomic writes, last-write-wins (architecture §6.3-§6.5) ([#4](https://github.com/mcbeebe/video-books/pull/4))
- 2026-04-29 feat(narration): ElevenLabs TTS client with typed errors, exponential-backoff retries on 429/5xx, DI'd `fetch` for unit tests (architecture §6.5) ([#5](https://github.com/mcbeebe/video-books/pull/5))
- 2026-04-29 refactor(http-utils): extract `retry` + `backoffDelay` from narration into `@video-books/http-utils` (no behavior change); feat(image-gen): fal.ai-shaped image client with style-anchor injection, two-step submit + fetch, typed errors (architecture §6.3) ([#6](https://github.com/mcbeebe/video-books/pull/6))
- 2026-04-29 feat(video-gen): provider-routed video client (kling / seedance / veo configs), `pickProvider(scene)` HERO→veo router, data-URL image inlining (architecture §6.4) ([#7](https://github.com/mcbeebe/video-books/pull/7))
- 2026-04-29 feat(assembler): pure `buildTimeline` + `buildFfmpegArgs`; `runFfmpeg` / `ffprobe` / `verifyOutput` wrappers with §6.8 verification (architecture §6.6-§6.8) ([#8](https://github.com/mcbeebe/video-books/pull/8))
- 2026-04-29 feat(cli): `wcap validate` / `wcap cost` / `wcap render` (stubbed) with `estimateCost` cost preflight, fully-DI'd `generateArtifacts` orchestrator (architecture §4, §6.2) ([#9](https://github.com/mcbeebe/video-books/pull/9))
- 2026-04-29 feat(cli,content): wire `wcap render` end-to-end (orchestrator → assembler), add 3-scene Muir fixture in `content/chapters/`, `content/style-anchors/wilderness-v1.txt`, integration test with mock providers exercises full render path (architecture §4, §6.6-§6.8) ([#10](https://github.com/mcbeebe/video-books/pull/10))
- 2026-04-29 docs(runbook,api-keys,arch): add `docs/RUNBOOK.md`, `docs/API_KEYS.md`, `docs/ARCHITECTURE.md` index; feat(scripts): smoke scripts for narration / image / video gated on API keys; chore(claude): mark Phase 1 tasks 1-10 complete ([#11](https://github.com/mcbeebe/video-books/pull/11))
- 2026-04-29 fix(video-gen,scripts,content): correct fal.ai model paths (verified live against fal.ai/models): veo3.1/fast/image-to-video, kling-video/v3/pro/image-to-video, bytedance/seedance-2.0/fast/image-to-video; smoke-image now writes `.jpg`/`.webp`/`.png` based on `content-type`; enrich `wilderness-v1.txt` style anchor with Yosemite + Sierra Nevada + Hudson River School / Bierstadt context for chapter 6's locations (Mount Hoffman, Lake Tenaya) ([#12](https://github.com/mcbeebe/video-books/pull/12))
- 2026-04-29 fix(video-gen): per-provider request body shape via `formatRequest` hook on `VideoProviderConfig` — kling sends `start_image_url` (not `image_url`) and stringified-int duration "3"-"15"; veo sends `"4s"|"6s"|"8s"` (with rounding-up); seedance sends "4"-"15" stringified-int; veo's `defaultDurationSec` bumped 5→6 (smallest valid)
