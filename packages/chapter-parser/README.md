# @video-books/chapter-parser

Reads a chapter spec JSON file from disk, validates it against `ChapterSpecSchema` from [`@video-books/types`](../types/README.md), and returns a typed `ChapterSpec`. Architecture §6.1.

## Exports

| Export                   | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `validateSpec(input)`    | Pure validation. Throws `ZodError` on shape mismatch (with `.issues` populated).                   |
| `parseChapterFile(path)` | Reads a file, parses JSON, validates. Throws `NodeJS.ErrnoException` / `SyntaxError` / `ZodError`. |

## Usage

```ts
import { parseChapterFile } from '@video-books/chapter-parser';
import { ZodError } from 'zod';

try {
  const spec = await parseChapterFile('content/chapters/chapter-6.spec.json');
  // spec is fully typed ChapterSpec — defaults applied, every field validated
} catch (err) {
  if (err instanceof ZodError) {
    // Schema mismatch — err.issues lists every problem
  } else if (err instanceof SyntaxError) {
    // File contents weren't valid JSON
  } else if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
    // File didn't exist
  } else {
    throw err;
  }
}
```

The parser does not catch and rewrap errors — that's the CLI's job (architecture §7), where each error kind maps to a `RenderError` discriminated-union variant.

## Testing this package

```sh
pnpm --filter @video-books/chapter-parser test
pnpm --filter @video-books/chapter-parser typecheck
```

Tests use real files in `os.tmpdir()` rather than mocking `node:fs` — the file IO is the whole point of this package.
