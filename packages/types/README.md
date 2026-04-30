# @video-books/types

Zod schemas and inferred TypeScript types for the WCAP render pipeline. Zod is the single source of truth — TS types are derived via `z.infer`.

Implements the data model in [`WCAP_Architecture_v1.md` §5](../../CLAUDE.md).

## Exports

| Export                                        | Purpose                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `BeatSchema` / `Beat`                         | One 5–10s narration unit (`{ id, sec, text }`).                    |
| `SceneSchema` / `Scene`                       | One visual scene (`HERO` or `SCENE`) with one or more beats.       |
| `ChapterSpecSchema` / `ChapterSpec`           | Top-level chapter spec — drives the entire pipeline.               |
| `validBeat`, `validScene`, `validChapterSpec` | Test fixtures — minimal valid instances usable as building blocks. |

## Usage

```ts
import { ChapterSpecSchema, type ChapterSpec } from '@video-books/types';

const raw: unknown = JSON.parse(await fs.readFile(path, 'utf8'));
const spec: ChapterSpec = ChapterSpecSchema.parse(raw); // throws ZodError on mismatch
```

For unknown-input boundaries (CLI args, file reads, network responses) prefer `safeParse` so you can branch on `success`:

```ts
const result = ChapterSpecSchema.safeParse(raw);
if (!result.success) {
  // result.error is a ZodError with rich .issues for diagnostics
}
```

## Testing this package

```sh
pnpm --filter @video-books/types test
pnpm --filter @video-books/types typecheck
```

## Adding a new schema

1. Add the Zod schema to `src/<topic>.ts`.
2. Export the inferred type via `z.infer`.
3. Add a fixture to `src/fixtures.ts` (minimal valid instance).
4. Add `<topic>.test.ts` covering the happy path and every error branch.
5. Re-export from `src/index.ts`.
