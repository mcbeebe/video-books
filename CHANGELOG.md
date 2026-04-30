# Changelog

Append one line per merged PR. CLAUDE.md treats this file as portable long-term memory across sessions.

Format: `YYYY-MM-DD <kind>(<scope>): <summary> (#<pr>)`. Kinds match the conventional-commit prefixes enforced by commitlint.

## Unreleased

- 2026-04-29 chore: bootstrap monorepo skeleton — pnpm workspace, tsconfig, ESLint, Vitest, Prettier, commitlint, GitHub Actions CI on push + PR (no PR — initial commit, [6a14716](https://github.com/mcbeebe/video-books/commit/6a14716))
- 2026-04-29 docs: add CI badge to README ([#1](https://github.com/mcbeebe/video-books/pull/1))
- 2026-04-29 feat(types): add Zod schemas + TS types for `Beat`, `Scene`, `ChapterSpec` (architecture §5); retire `packages/hello` placeholder ([#2](https://github.com/mcbeebe/video-books/pull/2))
- 2026-04-29 feat(chapter-parser): read + validate chapter spec JSON via `parseChapterFile` / `validateSpec` (architecture §6.1)
