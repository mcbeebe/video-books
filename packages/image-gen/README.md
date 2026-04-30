# @video-books/image-gen

Image generation client. Architecture §6.3.

**Endpoint shape:** fal.ai (`POST https://fal.run/<model>` → returns image URL → GET URL → bytes). Architecture §3 calls out "Midjourney V7 API (or fal.ai routing)" — this package targets the latter because the official Midjourney v7 endpoint shape is uncertain. If you have direct Midjourney API access, implement a sibling client following the same `ImageClient` interface.

## Exports

| Export                   | Purpose                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `createImageClient(cfg)` | Factory returning `{ generate(prompt, options?) }`.                                                          |
| `ImageApiError`          | Thrown on any failure. `.error: ImageError` (auth / rate-limit / server / bad-response / network / aborted). |

## Usage

```ts
import { createImageClient } from '@video-books/image-gen';

const client = createImageClient({
  apiKey: process.env['FAL_KEY']!,
  model: 'fal-ai/flux-pro/v1.1',
  styleAnchor: await fs.readFile('content/style-anchors/wilderness-v1.txt', 'utf8'),
  imageSize: 'landscape_16_9',
});

const { image, sourceUrl } = await client.generate('A high-altitude meadow at dawn');
await fs.writeFile('scene-1.png', image);
console.log(`generated from ${sourceUrl}`);
```

The style anchor is appended to every prompt — keep it in `content/style-anchors/` and load once at startup.

## Per-call overrides

```ts
// Hero scenes routed to a higher-fidelity model:
await client.generate(prompt, { model: 'fal-ai/flux-pro/v1.1-ultra' });
// Reproducible output:
await client.generate(prompt, { seed: 42 });
// Negative prompt:
await client.generate(prompt, { negativePrompt: 'people, text, watermark' });
```

## Smoke test (manual — costs real money)

Per `CLAUDE.md` Phase 1 task #6: smoke test on 5 scenes; review with user before bulk gen.

```sh
FAL_KEY=… pnpm tsx packages/image-gen/scripts/smoke.ts
```

The smoke script (planned for PR #11) generates 5 representative scenes from the Chapter 6 spec so you can review composition before the full 137-scene run.

## Verifying endpoint shape before smoke

The architecture predates the actual smoke test; the assumed shape is fal.ai's documented sync endpoint. **Before running the smoke**, hit the endpoint manually with `curl` to confirm the response shape matches `{ images: [{ url, content_type }] }`. If it doesn't, the `bad-response` error path will fire and you'll know exactly which assumption broke.
