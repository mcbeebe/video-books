# Runbook

Operating the WCAP render pipeline. For architecture see `WCAP_Architecture_v1.md` (in the deliverables folder); for project conventions see `CLAUDE.md` at the repo root.

## Setup

```sh
corepack enable
pnpm install
cp .env.example .env   # then edit per docs/API_KEYS.md
```

## Daily commands

| Command                                                   | What it does                                       |
| --------------------------------------------------------- | -------------------------------------------------- |
| `pnpm typecheck`                                          | TypeScript project-references build                |
| `pnpm lint`                                               | ESLint strict-type-checked                         |
| `pnpm test`                                               | Vitest                                             |
| `pnpm format` / `pnpm format:fix`                         | Prettier                                           |
| `pnpm wcap validate <spec.json>`                          | Parse + summarize a spec (no API calls)            |
| `pnpm wcap cost <spec.json>`                              | Cost preflight (no API calls)                      |
| `pnpm wcap render <spec.json> [--max-cost N] [--confirm]` | Full render: stills → clips → audio → ffmpeg → MP4 |

(`pnpm wcap` is shorthand for `pnpm exec wcap` once the CLI is built; see `Build` below.)

## Build the CLI binary

The `wcap` bin is built via TypeScript project references:

```sh
pnpm typecheck   # also builds dist/ for every package
node packages/cli/dist/bin.js validate content/chapters/fixture.spec.json
```

Or, in development, run the source directly via `tsx`:

```sh
pnpm tsx packages/cli/src/bin.ts validate content/chapters/fixture.spec.json
```

## Smoke tests (cost real money — keys required)

Each smoke script exercises one external API against the 3-scene fixture and prints the result.

```sh
pnpm tsx scripts/smoke-narration.ts content/chapters/fixture.spec.json
pnpm tsx scripts/smoke-image.ts     content/chapters/fixture.spec.json
pnpm tsx scripts/smoke-video.ts     content/chapters/fixture.spec.json
```

- **narration** — synthesizes the first beat of each scene; ~$0.01 per beat.
- **image** — generates the still for each scene; ~$0.05 per image.
- **video** — generates the clip for each scene; ~$0.50 per 5s clip.

Total smoke spend: under $5. **Run each in sequence; review the outputs in `cache/` before running the next.**

The smoke scripts skip cached entries, so re-running is free if nothing changed.

## Troubleshooting

### `wcap render` fails with `missing required env vars`

You haven't set `FAL_KEY` / `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`. See `docs/API_KEYS.md`.

### `wcap render` fails with `cost estimate $X exceeds --max-cost`

Either bump `--max-cost`, or pass `--confirm` to acknowledge.

### A specific scene fails repeatedly

Inspect `cache/` for a partial artifact:

```sh
ls cache/images/ cache/clips/ cache/audio/
```

To force regeneration of one item, just delete its file from the cache and re-run `wcap render`. The orchestrator skips anything already cached.

### ffmpeg fails

The exit code + stderr land in the thrown error message. If it's "filter not found" or similar, check `ffmpeg -version` — you need a build with libx264, AAC, and `xfade`/`amix` filters (the standard Homebrew/`apt-get install ffmpeg` builds include all of these).

### CI is red after a merge

CI runs `typecheck` / `lint` / `test` / `format` / `commitlint` on every PR. Re-run locally to reproduce:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm format
```

The 2 `runFfmpeg` integration tests in `packages/assembler` are gated on `ffmpeg` being on `$PATH`. They auto-skip locally if you don't have it; CI's `ubuntu-latest` runners include both `ffmpeg` and `ffprobe`.

## Cache layout

Once you've run a render or smoke:

```
cache/
├── images/<sha256>.png    # one per unique (prompt + styleAnchor + provider + model)
├── clips/<sha256>.mp4     # one per unique (imageHash + motion + provider)
└── audio/<sha256>.mp3     # one per unique (text + voiceId + model)
```

Architecture §6.3-§6.5 documents the key derivation. Same inputs → same hash → free hit.

To wipe everything and start fresh:

```sh
rm -rf cache/ output/
```

## Adding a new chapter

1. Author the spec as JSON matching `ChapterSpecSchema` (see `packages/types/src/chapter.ts`).
2. Place it at `content/chapters/<slug>.spec.json`.
3. Validate: `pnpm wcap validate content/chapters/<slug>.spec.json` — flags any scene whose total beat duration exceeds the routed provider's max clip length (kling: 15s).
4. Cost: `pnpm wcap cost content/chapters/<slug>.spec.json`
5. Render: `pnpm wcap render content/chapters/<slug>.spec.json --max-cost <N>`

## Authoring motion prompts (sleep / soundscape niche)

Every scene needs a `motion` field. The default router sends every scene to **kling v3 Pro** (deliberate, cinematic, ~5–15s clips). To get continuous motion the audience can fall asleep to:

- **Lead with `slow` or `very slow`** to anchor the pace.
- **Single direction, single subject.** Two-subject prompts get interpreted as cross-fades between two shots, which jolt the viewer awake.

| Avoid (multi-subject)           | Prefer (single continuous move)                                 |
| ------------------------------- | --------------------------------------------------------------- |
| `tilt from sky to lake`         | `slow downward tilt over the lake, sky visible at top of frame` |
| `pan from forest to ridge`      | `slow rightward pan along the ridge, forest in foreground`      |
| `zoom out revealing valley`     | `slow camera pull-back, valley emerges in frame`                |
| `dissolve from morning to noon` | `slow push-in across the meadow at morning light`               |

If you find a scene that needs a more dynamic shot (transitions, reveals, etc.) override the router by passing `provider: 'veo'` per-scene at the orchestrator layer — Veo handles non-continuous motion better than kling.

## Authoring beat durations

Each scene maps to **one** clip from the routed provider. The clip can be at most:

| Provider          | Max clip length     |
| ----------------- | ------------------- |
| kling v3 pro      | 15s                 |
| seedance 2.0 fast | 15s                 |
| veo3.1 fast       | 8s (4 / 6 / 8 only) |

`wcap validate` will flag any scene whose `sum(beats[].sec)` exceeds the routed provider's max. To fix: split the scene into multiple shorter scenes, each with its own image + motion + beats.
