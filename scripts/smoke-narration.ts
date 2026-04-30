#!/usr/bin/env tsx
/**
 * Narration smoke test — synthesizes the first beat of each scene in the
 * given spec and writes the audio to `output/smoke/narration/`.
 *
 * Cost: ~$0.01 per beat (3-scene fixture → ~$0.03).
 *
 * Usage:
 *   ELEVENLABS_API_KEY=… ELEVENLABS_VOICE_ID=… \
 *     pnpm tsx scripts/smoke-narration.ts content/chapters/fixture.spec.json
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseChapterFile } from '@video-books/chapter-parser';
import { createNarrationClient } from '@video-books/narration';

async function main(): Promise<void> {
  const specPath = process.argv[2];
  if (specPath === undefined) {
    console.error('usage: tsx scripts/smoke-narration.ts <spec.json>');
    process.exit(1);
  }
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (apiKey === undefined || voiceId === undefined || apiKey === '' || voiceId === '') {
    console.error('set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID');
    process.exit(1);
  }

  const spec = await parseChapterFile(specPath);
  const outDir = `output/smoke/narration/${spec.slug}`;
  await mkdir(outDir, { recursive: true });
  const client = createNarrationClient({ apiKey, voiceId });

  for (const scene of spec.scenes) {
    const beat = scene.beats[0];
    if (!beat) continue;
    console.log(`[scene ${scene.n.toString()}] ${beat.id} (${beat.text.length.toString()} chars)`);
    const t = Date.now();
    const { audio, requestId } = await client.generate(beat.text);
    const ms = Date.now() - t;
    const outPath = join(outDir, `${beat.id}.mp3`);
    await writeFile(outPath, audio);
    console.log(
      `  → ${outPath} (${audio.length.toString()} bytes, ${ms.toString()}ms, req=${requestId ?? 'n/a'})`,
    );
  }
  console.log(`✓ wrote narration smoke samples to ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
