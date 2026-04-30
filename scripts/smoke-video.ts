#!/usr/bin/env tsx
/**
 * Video smoke test — generates one clip per scene in the given spec and
 * writes them to `output/smoke/clips/`. Requires a smoke-image run first
 * (uses cached PNGs from `output/smoke/images/<slug>/`).
 *
 * Cost: ~$0.07/sec for kling, ~$0.05/sec for veo (3-scene fixture, 5s clips
 * → ~$1).
 *
 * Usage:
 *   FAL_KEY=… pnpm tsx scripts/smoke-video.ts content/chapters/fixture.spec.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChapterFile } from '@video-books/chapter-parser';
import { createVideoClient, pickProvider } from '@video-books/video-gen';

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (specPath === undefined) {
    console.error('usage: tsx scripts/smoke-video.ts <spec.json>');
    process.exit(1);
  }
  const apiKey = process.env.FAL_KEY;
  if (apiKey === undefined || apiKey === '') {
    console.error('set FAL_KEY');
    process.exit(1);
  }

  const spec = await parseChapterFile(specPath);
  const imageDir = `output/smoke/images/${spec.slug}`;
  const outDir = `output/smoke/clips/${spec.slug}`;
  await mkdir(outDir, { recursive: true });
  const client = createVideoClient({ apiKey, defaultProvider: 'kling' });

  for (const scene of spec.scenes) {
    const provider = pickProvider(scene);
    const imagePath = join(imageDir, `${scene.n.toString().padStart(3, '0')}.png`);
    let image: Uint8Array;
    try {
      image = await readFile(imagePath);
    } catch {
      console.error(`missing ${imagePath} — run smoke-image.ts first`);
      process.exit(1);
    }
    console.log(`[scene ${scene.n.toString()}] provider=${provider} motion="${scene.motion}"`);
    const t = Date.now();
    const result = await client.generate({ image, motion: scene.motion, provider });
    const ms = Date.now() - t;
    const outPath = join(outDir, `${scene.n.toString().padStart(3, '0')}.mp4`);
    await writeFile(outPath, result.video);
    console.log(
      `  → ${outPath} (${(result.video.length / 1024).toFixed(1)} KB, ${(result.durationSec ?? 0).toString()}s, ${ms.toString()}ms)`,
    );
    console.log(`    src: ${result.sourceUrl}`);
  }
  console.log(`✓ wrote video smoke samples to ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
