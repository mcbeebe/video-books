# CLAUDE.md — video-books (WCAP Code Repo)

> This file is read by Claude Code at the start of every session.
> Keep it concise and current. Update it when project state changes meaningfully.

## Project

**WCAP** = Wilderness Classics Audio-Video Pilot.
**Repo name:** `video-books` (project name remains WCAP).

Long-form ambient audio-video adaptations of public-domain American wilderness writing
(Muir, Thoreau, Bartram, Austin, Roosevelt, Parkman) for the YouTube sleep / soundscape niche.

**Current focus:** Pilot — single chapter video.

- **Source work:** John Muir, _My First Summer in the Sierra_ (1911), Chapter 6 — "Mount Hoffman and Lake Tenaya"
- **Public domain status:** confirmed (Project Gutenberg #32540)
- **Runtime target:** ~43 minutes
- **Scenes:** 137 (51 hero, 86 standard) — chunked in `content/chapters/chapter-6.spec.json`
- **Pilot budget:** $500 (realistic cost ~$143)
- **Target launch:** June 1, 2026
- **Distribution:** YouTube unlisted → public if signal positive

The user will edit the final video by hand in DaVinci Resolve. This repo's job is the
**asset generation pipeline** (images, video clips, narration) and eventually the
**automated render pipeline** for Phase 2 (post-pilot, multi-chapter scale-up).

## Reference docs (in the user's deliverables folder, not this repo)

The user maintains polished docs at:
`~/Desktop/CLAUDE/Public Domain Book Publishing/`

- `WCAP_Business_Plan_v1.docx` — strategy, market data, roadmap, risks
- `WCAP_Cost_Revenue_Model_v1.xlsx` — budget, scaling, break-even
- `WCAP_Chapter6_Pilot_Pack_v2.docx` — locked style anchor, all 137 scenes with prompts and narration beats
- `WCAP_Architecture_v1.md` — full pipeline architecture (this repo implements it)
- `CLAUDE_cowork.md` — Cowork-side conventions for that folder

When in doubt, ask the user to read out the relevant section. Do not assume the docs are in this repo.

---

## How to work in this repo

### Code style (non-negotiable)

- **TypeScript strict mode.** Always.
- **Functional components with hooks** (when/if any UI is added later).
- **Error handling in every async function** — try/catch, no unhandled rejections.
- **JSDoc on every exported function.** Include `@param`, `@returns`, `@throws`, and at least one `@example` for non-trivial functions.
- **Inline comments minimal and purposeful** — explain _why_, not _what_.
- **Small files (≤300 lines).** Split when growing past that.
- **Tests beside source files:** `foo.ts` → `foo.test.ts`.
- **No clever metaprogramming** — plain functions and data.
- **Zod schemas mirror TypeScript types** — Zod is the source of truth, TS types derived via `z.infer`.

### Planning before coding

For any task touching multiple files or introducing a new module:

1. Outline the approach and trade-offs _first_.
2. Wait for explicit user approval.
3. Then write code.

For trivial tasks (single-file edit, fixing a bug with a clear repro), skip the plan and proceed.

### Testing

- Use Vitest. Aim for ≥80% coverage on business logic.
- **Unit tests alongside every new feature.** No exceptions.
- Test happy paths AND error branches AND edge cases.
- Pre-merge gate: `pnpm typecheck && pnpm lint && pnpm test` must all pass.
- **Critical:** never tell the user a feature is done until tests pass. Pushing failing code is unacceptable.

### Version control

- **Commit and push after every meaningful unit of work.** Nothing must be lost.
- Conventional commits enforced via commitlint:
  `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`, `perf:`, `ci:`
- Branch per feature; PR back to `main`.
- After any successful change, run the test suite _before_ committing.

### Documentation

- Add JSDoc to every exported function.
- Maintain `README.md` per package.
- Update `docs/ARCHITECTURE.md` when adding/removing modules (file pending — see Phase 1 task #2).
- Keep `CHANGELOG.md` current — append a line per merged PR (date, kind, summary). This is your portable long-term memory across sessions. (File pending — created with first feature PR.)

---

## Repo structure (target — see `WCAP_Architecture_v1.md` for full detail)

```
video-books/
├── packages/
│   ├── types/              # Zod schemas + TS types (no deps)
│   ├── chapter-parser/     # JSON spec → typed object
│   ├── image-gen/          # Midjourney client wrapper
│   ├── video-gen/          # Kling/Seedance/Veo router
│   ├── narration/          # ElevenLabs client
│   ├── assembler/          # FFmpeg orchestration
│   ├── cache/              # Content-addressable filesystem cache
│   └── cli/                # `wcap` command
├── content/
│   ├── chapters/chapter-6.spec.json
│   ├── style-anchors/wilderness-v1.txt
│   └── ambient/forest-loop.mp3   (licensed; gitignored)
├── output/                 # Generated assets (gitignored)
├── docs/
│   ├── ARCHITECTURE.md
│   ├── RUNBOOK.md
│   └── API_KEYS.md
└── CHANGELOG.md
```

Current state: only the bootstrap skeleton + `packages/hello` placeholder. Each Phase 1 item below adds one of the above.

---

## Cost controls — IMPORTANT

External API calls cost real money. Treat every batch as a financial transaction.

- **Always pre-flight cost estimate before any external API call.** Show estimated $ to the user. Wait for explicit `y`/`yes` confirmation before proceeding.
- **Hard ceiling:** never spend more than $50 in a single batch without explicit user approval. Configured via `MAX_PILOT_COST_USD` in `.env`.
- **Cache aggressively.** Content-addressable cache keyed by SHA256 of `(prompt + style anchor + provider + model)`. Cached calls are free.
- **Log every external call:** timestamp, stage, sceneId/beatId, latencyMs, costUsd, status. Append to `output/<slug>/<timestamp>.log.jsonl`.
- **`wcap cost <spec>`** must run estimate-only without generating anything.

If a script _might_ hit external APIs, prefer running it in dry-run mode first.

---

## API providers (current as of April 2026 — verify before integrating)

- **Image gen:** Midjourney V7 (Standard plan $30/mo)
- **Video gen:** Kling 3.0 (~$0.07/sec at 720p) — primary choice. Alternates: Seedance 2.0 Fast ($0.022/sec at 1080p), Veo 3.1 Lite ($0.05/sec, audio included)
- **Narration:** ElevenLabs Creator plan ($22/mo, 100K characters). Pilot will test 3 voices on scenes 1, 58, 86 before committing.
- **Music:** Epidemic Sound (~$15/mo) for ambient bed

API keys live in `.env`, **never committed**. Validated at startup via Zod.

---

## Phase 1 task list (pilot)

Track progress in `CHANGELOG.md` (when created). Each completed item gets a dated line.

1. [ ] Bootstrap repo: pnpm workspace, tsconfig.base.json, eslint, vitest, GitHub Actions CI green on hello-world. ← **in progress**
2. [ ] `packages/types`: Zod schemas + TS types for `Beat`, `Scene`, `ChapterSpec`. Tested against fixture.
3. [ ] `packages/chapter-parser`: read JSON, validate, return typed object.
4. [ ] `packages/cache`: content-addressable filesystem cache (get/set/has, with hash key derivation).
5. [ ] `packages/narration`: ElevenLabs client. Smoke test on scenes 1, 58, 86 (the user wants to compare voices).
6. [ ] `packages/image-gen`: Midjourney client. Smoke test on 5 scenes; review with user before bulk gen.
7. [ ] `packages/video-gen`: Kling client. Smoke test on 3 scenes.
8. [ ] `packages/assembler`: FFmpeg invocation wrappers (concat clips, mix audio, master output).
9. [ ] `packages/cli`: `wcap` command wiring (`render`, `generate`, `validate`, `cost`).
10. [ ] End-to-end test: 3-scene fixture chapter rendered start to finish.
11. [ ] First real run: full Chapter 6 spec → all 137 stills generated and reviewed.

Mark items complete only after tests pass.

---

## Honest behaviour expectations from the user

The user has stated explicitly:

- **It's okay to say "I don't know."** Don't guess.
- **Always ask for clarification on ambiguous requests.**
- **Take time. Never rush.**
- **QA/QC and test all code before declaring done.**
- **Fact-check with sources and links.**
- **Use bullets, bolding, and summaries** for longer responses.
- **Plan first for multi-file work; wait for approval.**

When uncertain about something, search the codebase, run `--dry-run`, or ask. Do not invent.

---

## Out of scope for this repo

- Final video editing (user does this in DaVinci Resolve)
- Marketing materials, YouTube descriptions, thumbnails (user does this in Cowork against the deliverables folder)
- Business plan / cost model updates (user does this in Cowork)
- Web app / subscription product (separate future project)

---

_Last updated: April 29, 2026 (bootstrap PR)_
