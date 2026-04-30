import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { ffprobe, runFfmpeg as realRunFfmpeg } from '@video-books/assembler';
import { createCache } from '@video-books/cache';
import { parseChapterFile } from '@video-books/chapter-parser';
import { createImageClient } from '@video-books/image-gen';
import { createNarrationClient } from '@video-books/narration';
import type { ChapterSpec } from '@video-books/types';
import { createVideoClient, pickProvider } from '@video-books/video-gen';
import { estimateCost, formatCost } from './cost.js';
import { runRender } from './render.js';

/** Logger interface — `console`-compatible. Tests inject a buffer. */
export interface Logger {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface RunOptions {
  argv: string[];
  logger: Logger;
  /** Override the spec loader for tests. */
  loadSpec?: (path: string) => Promise<ChapterSpec>;
}

const HELP = `
wcap — WCAP render pipeline CLI

Usage:
  wcap validate <spec.json>           Parse and validate a spec
  wcap cost     <spec.json>           Show cost preflight estimate
  wcap render   <spec.json> [opts]    Render the chapter to MP4 (TODO)

Render options:
  --max-cost N      Refuse to proceed if estimate exceeds $N (default 50)
  --confirm         Skip the interactive confirmation
  --output PATH     Output path (default: output/<slug>.mp4)
`.trim();

/**
 * Entry point — parses argv and dispatches the subcommand.
 *
 * @returns Process exit code (0 success, non-zero failure).
 */
export async function run(opts: RunOptions): Promise<number> {
  const loadSpec = opts.loadSpec ?? parseChapterFile;
  const args = opts.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    opts.logger.log(HELP);
    return args.length === 0 ? 1 : 0;
  }

  const subcommand = args[0];
  const rest = args.slice(1);

  try {
    switch (subcommand) {
      case 'validate':
        return await runValidate(rest, loadSpec, opts.logger);
      case 'cost':
        return await runCost(rest, loadSpec, opts.logger);
      case 'render':
        return await runRenderCommand(rest, loadSpec, opts.logger);
      default:
        opts.logger.error(`unknown command: ${subcommand ?? ''}`);
        opts.logger.log(HELP);
        return 1;
    }
  } catch (err) {
    opts.logger.error(formatError(err));
    return 1;
  }
}

async function runValidate(
  args: string[],
  loadSpec: (p: string) => Promise<ChapterSpec>,
  logger: Logger,
): Promise<number> {
  const path = args[0];
  if (path === undefined) {
    logger.error('usage: wcap validate <spec.json>');
    return 1;
  }
  const spec = await loadSpec(path);
  const totalSec = spec.scenes.reduce(
    (s, scene) => s + scene.beats.reduce((b, beat) => b + beat.sec, 0),
    0,
  );
  const totalBeats = spec.scenes.reduce((s, scene) => s + scene.beats.length, 0);
  logger.log(`✓ ${spec.slug} — "${spec.title}"`);
  logger.log(
    `  ${spec.scenes.length.toString()} scenes, ${totalBeats.toString()} beats, ${totalSec.toString()}s total`,
  );
  return 0;
}

async function runCost(
  args: string[],
  loadSpec: (p: string) => Promise<ChapterSpec>,
  logger: Logger,
): Promise<number> {
  const path = args[0];
  if (path === undefined) {
    logger.error('usage: wcap cost <spec.json>');
    return 1;
  }
  const spec = await loadSpec(path);
  logger.log(formatCost(estimateCost(spec)));
  return 0;
}

async function runRenderCommand(
  args: string[],
  loadSpec: (p: string) => Promise<ChapterSpec>,
  logger: Logger,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    options: {
      'max-cost': { type: 'string' },
      confirm: { type: 'boolean' },
      output: { type: 'string' },
      'cache-dir': { type: 'string' },
    },
    allowPositionals: true,
  });
  const path = positionals[0];
  if (path === undefined) {
    logger.error(
      'usage: wcap render <spec.json> [--max-cost N] [--confirm] [--output PATH] [--cache-dir DIR]',
    );
    return 1;
  }

  const env = process.env;
  const missing = ['FAL_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'].filter(
    (k) => env[k] === undefined || env[k] === '',
  );
  if (missing.length > 0) {
    logger.error(`missing required env vars: ${missing.join(', ')}`);
    logger.error('see docs/API_KEYS.md (PR #11) for setup');
    return 1;
  }

  const spec = await loadSpec(path);
  const styleAnchorPath = join(dirname(path), '..', spec.styleAnchor.replace(/^content\//, ''));
  const styleAnchor = await readFile(spec.styleAnchor, 'utf8').catch(async () =>
    readFile(styleAnchorPath, 'utf8'),
  );

  const cacheDir = values['cache-dir'] ?? 'cache';
  const outputPath = values.output ?? `output/${spec.slug}.mp4`;
  const maxCostUsd = Number(values['max-cost'] ?? '50');
  const confirm = values.confirm ?? false;

  const result = await runRender(
    spec,
    {
      cache: createCache(cacheDir),
      imageClient: createImageClient({
        apiKey: env.FAL_KEY ?? '',
        model: 'fal-ai/flux-pro/v1.1',
      }),
      videoClient: createVideoClient({
        apiKey: env.FAL_KEY ?? '',
        defaultProvider: 'kling',
      }),
      narrationClient: createNarrationClient({
        apiKey: env.ELEVENLABS_API_KEY ?? '',
        voiceId: env.ELEVENLABS_VOICE_ID ?? '',
      }),
      pickProvider,
      styleAnchor: styleAnchor.trim(),
      imageProvider: 'fal-ai/flux-pro',
      imageModel: 'v1.1',
      narrationVoiceId: env.ELEVENLABS_VOICE_ID ?? '',
      narrationModel: 'eleven_multilingual_v2',
      runFfmpeg: realRunFfmpeg,
      ffprobe,
      logger,
    },
    { outputPath, maxCostUsd, confirm },
  );

  logger.log(`Cost: $${result.cost.totalUsd.toFixed(2)}`);
  logger.log(`Output: ${result.outputPath}`);
  return 0;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
