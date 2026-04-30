# @video-books/video-gen

Video clip generation client with provider routing. Architecture §6.4.

**Endpoint shape:** fal.ai sync (`POST /<modelPath>` returns video URL → `GET` for bytes). Three providers ship out of the box, each as a `VideoProviderConfig` you can override:

| Name       | Default `modelPath`         | Architecture role                         |
| ---------- | --------------------------- | ----------------------------------------- |
| `kling`    | `fal-ai/kling-video/v3/std` | Default for `SCENE`-type scenes           |
| `seedance` | `fal-ai/seedance/v2/fast`   | Cost-optimized alternate                  |
| `veo`      | `fal-ai/veo3/lite`          | Default for `HERO`-type scenes (per §6.4) |

**Verify model paths against https://fal.ai/models before smoke testing** — fal iterates these slugs frequently.

## Exports

| Export                   | Purpose                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `createVideoClient(cfg)` | Factory returning `{ generate(input) }`.                                                                           |
| `pickProvider(scene)`    | Pure router — `HERO → 'veo'`, otherwise `'kling'`.                                                                 |
| `KLING / SEEDANCE / VEO` | Default `VideoProviderConfig` constants — pass to `config.providers` to swap.                                      |
| `VideoApiError`          | Thrown on failure. `.error: VideoError` (auth / rate-limit / server / timeout / bad-response / network / aborted). |

## Usage

```ts
import { createVideoClient, pickProvider } from '@video-books/video-gen';

const client = createVideoClient({
  apiKey: process.env['FAL_KEY']!,
  defaultProvider: 'kling',
});

for (const scene of spec.scenes) {
  const imageBytes = await cache.get('images', sceneKey(scene), 'png');
  const { video } = await client.generate({
    image: imageBytes!, // or a CDN URL
    motion: scene.motion,
    provider: pickProvider(scene),
  });
  await cache.set('clips', clipKey(scene), 'mp4', video);
}
```

## Image input

`input.image` accepts either:

- **`string`** — an HTTPS URL the provider can fetch directly. Cheapest path.
- **`Uint8Array`** — bytes that the client base64-encodes as an inline `data:image/png;base64,...` URL. Fine for the pilot's ~1MB stills; for larger images upload to a CDN first.

## Per-scene provider overrides

```ts
// Hero scenes get veo automatically:
await client.generate({ image, motion, provider: pickProvider(scene) });

// Or override unconditionally:
await client.generate({ image, motion, provider: 'seedance' });
```

## Limitations / future work

- **Sync API only.** Works for ≤10s clips on most providers. Longer clips need the queue API (POST → poll → GET) — out of scope for the pilot.
- **No image upload.** Bytes are inlined as data URLs. Add `fal.storage.upload()` when image sizes outgrow the inline budget.
- **Cost reporting** isn't read from the response — providers vary on whether/how they expose this. Add when you settle on one.

## Smoke test (manual — costs real money)

Per `CLAUDE.md` Phase 1 task #7: smoke test on 3 scenes.

```sh
FAL_KEY=… pnpm tsx packages/video-gen/scripts/smoke.ts
```

The smoke script (planned for PR #11) generates 3 representative clips so you can sanity-check before bulk gen.
