# Architecture

The full architecture lives outside this repo (Cowork-side deliverable):

> `~/Desktop/CLAUDE/Public Domain Book Publishing/WCAP_Architecture_v1.md`

This file is a quick index of where each architecture section is implemented in the code.

| Architecture section           | Implementation                                                         |
| ------------------------------ | ---------------------------------------------------------------------- |
| §3 Tech stack                  | Root `package.json`, `tsconfig.base.json`, `eslint.config.js`          |
| §4 Repository structure        | `packages/`, `content/`, `output/` (gitignored), `docs/`               |
| §5 Core data model             | `packages/types` — `BeatSchema`, `SceneSchema`, `ChapterSpecSchema`    |
| §6.1 Validate                  | `packages/chapter-parser` — `validateSpec` / `parseChapterFile`        |
| §6.2 Cost preflight            | `packages/cli/src/cost.ts` — `estimateCost` / `formatCost`             |
| §6.3 Image generation          | `packages/image-gen` — fal.ai-shaped client                            |
| §6.4 Video clip generation     | `packages/video-gen` — provider router (kling / seedance / veo)        |
| §6.5 Narration                 | `packages/narration` — ElevenLabs client                               |
| §6.6 Timeline build            | `packages/assembler/src/timeline.ts` — `buildTimeline`                 |
| §6.7 FFmpeg assembly           | `packages/assembler/src/filtergraph.ts` + `ffmpeg.ts`                  |
| §6.8 Verify                    | `packages/assembler/src/ffmpeg.ts` — `verifyOutput`                    |
| §7 Error handling              | Each client throws a typed `*ApiError` with `.error: <Discriminated>`  |
| §9 Configuration & secrets     | `.env.example`; loaded via `process.env` in `packages/cli/src/main.ts` |
| §10 Cost controls              | `--max-cost N` + `--confirm` flags in `wcap render`                    |
| §11 Observability              | `onProgress` callback in the orchestrator (pino integration: future)   |
| §13 Phase-by-phase build order | See `CHANGELOG.md` for the merged sequence                             |

When the architecture changes (rare; deliverable-folder doc is versioned `_vN`), update this index alongside the implementing PR.
