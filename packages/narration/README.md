# @video-books/narration

ElevenLabs text-to-speech client. Architecture §6.5.

Voice consistency requires a stable `voiceId` and (recommended) sequential calls per voice. Concurrency is the caller's responsibility — this package gives you one `generate` call; orchestrate however you like.

## Exports

| Export                       | Purpose                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `createNarrationClient(cfg)` | Factory returning `{ generate(text, options?) }`.                                   |
| `NarrationApiError`          | Thrown by `generate` on any failure. Has `.error: NarrationError` (discriminated).  |
| `retry`, `backoffDelay`      | Generic retry helper used internally — exported for reuse by image-gen / video-gen. |

## Usage

```ts
import { createNarrationClient } from '@video-books/narration';

const client = createNarrationClient({
  apiKey: process.env['ELEVENLABS_API_KEY']!,
  voiceId: process.env['ELEVENLABS_VOICE_ID']!,
  voiceSettings: { stability: 0.5, similarityBoost: 0.75 },
});

const { audio, requestId } = await client.generate('A clear cold morning on the meadow.');
await fs.writeFile('beat-1.1.mp3', audio);
```

## Error handling

```ts
try {
  await client.generate(text);
} catch (err) {
  if (err instanceof NarrationApiError) {
    switch (err.error.kind) {
      case 'auth':
        /* check API key */ break;
      case 'rate-limit':
        /* err.error.retryAfterMs may be set */ break;
      case 'server':
        /* transient server fault */ break;
      case 'network':
        /* connection issue */ break;
      case 'aborted':
        /* AbortSignal fired */ break;
    }
  }
}
```

`auth` and `aborted` are not retried. `rate-limit` and `server` (5xx) are retried with exponential backoff (5 attempts default).

## Smoke test (manual — costs real money)

```sh
ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… pnpm tsx packages/narration/scripts/smoke.ts
```

The smoke script (planned for PR #11) generates the same beat with three voice IDs so you can A/B/C compare per `CLAUDE.md` Phase 1 task #5.

## Testing

```sh
pnpm --filter @video-books/narration test
```

Unit tests inject `fetch` (no global mocking, no real network).
