#!/usr/bin/env tsx
/**
 * Image smoke test — generates one still per scene in the given spec and
 * writes them to `output/smoke/images/`.
 *
 * Cost: ~$0.05 per image (3-scene fixture → ~$0.15).
 *
 * Usage:
 *   FAL_KEY=… pnpm tsx scripts/smoke-image.ts content/chapters/fixture.spec.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChapterFile } from '@video-books/chapter-parser';
import { createImageClient } from '@video-books/image-gen';

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (specPath === undefined) {
    console.error('usage: tsx scripts/smoke-image.ts <spec.json>');
    process.exit(1);
  }
  const apiKey = process.env.FAL_KEY;
  if (apiKey === undefined || apiKey === '') {
    console.error('set FAL_KEY');
    process.exit(1);
  }

  const spec = await parseChapterFile(specPath);
  const styleAnchor = (await readFile(spec.styleAnchor, 'utf8')).trim();
  const outDir = `output/smoke/images/${spec.slug}`;
  await mkdir(outDir, { recursive: true });
  const client = createImageClient({
    apiKey,
    model: 'fal-ai/flux-pro/v1.1',
    styleAnchor,
    imageSize: 'landscape_16_9',
  });

  for (const scene of spec.scenes) {
    console.log(`[scene ${scene.n.toString()}] ${scene.image.slice(0, 60)}…`);
    const t = Date.now();
    const { image, sourceUrl, width, height, requestId } = await client.generate(scene.image);
    const ms = Date.now() - t;
    const outPath = join(outDir, `${scene.n.toString().padStart(3, '0')}.png`);
    await writeFile(outPath, image);
    console.log(
      `  → ${outPath} (${(image.length / 1024).toFixed(1)} KB, ${(width ?? 0).toString()}×${(height ?? 0).toString()}, ${ms.toString()}ms, req=${requestId ?? 'n/a'})`,
    );
    console.log(`    src: ${sourceUrl}`);
  }
  console.log(`✓ wrote image smoke samples to ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
