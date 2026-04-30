# video-books

WCAP (Wilderness Classics Audio-Video Pilot) render pipeline. Produces long-form ambient audio-video adaptations of public-domain American wilderness writing from a structured chapter spec.

See [`CLAUDE.md`](./CLAUDE.md) for project conventions and the deliverables-folder copy of `WCAP_Architecture_v1.md` for full pipeline architecture.

## Quickstart

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

## Scripts

| Script            | Purpose                             |
| ----------------- | ----------------------------------- |
| `pnpm typecheck`  | TypeScript project-references build |
| `pnpm lint`       | ESLint (strict-type-checked)        |
| `pnpm test`       | Vitest run                          |
| `pnpm test:watch` | Vitest watch mode                   |
| `pnpm format`     | Prettier check                      |
| `pnpm format:fix` | Prettier write                      |

## Workspace layout

```
packages/
  hello/         # Bootstrap placeholder; replaced by packages/types in PR #2
```

## Contributing

All changes flow through pull requests against `main`. CI must be green before merge. Conventional Commits are enforced by commitlint in CI.
