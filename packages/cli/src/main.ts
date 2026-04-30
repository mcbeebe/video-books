import { parseArgs } from 'node:util';
import { parseChapterFile } from '@video-books/chapter-parser';
import type { ChapterSpec } from '@video-books/types';
import { estimateCost, formatCost } from './cost.js';

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
        return runRender(rest, opts.logger);
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

function runRender(args: string[], logger: Logger): number {
  // Surface the parsed args so the user sees what would be wired up;
  // actual rendering wires together cli/orchestrator + assembler in PR #10
  // (e2e fixture) where we have a 3-scene fixture to validate against.
  const { values, positionals } = parseArgs({
    args,
    options: {
      'max-cost': { type: 'string' },
      confirm: { type: 'boolean' },
      output: { type: 'string' },
    },
    allowPositionals: true,
  });
  const path = positionals[0];
  if (path === undefined) {
    logger.error('usage: wcap render <spec.json> [--max-cost N] [--confirm] [--output PATH]');
    return 1;
  }
  logger.log('render: not yet implemented in this PR');
  logger.log(`  spec:     ${path}`);
  logger.log(`  max-cost: ${values['max-cost'] ?? '50'}`);
  logger.log(`  confirm:  ${(values.confirm ?? false).toString()}`);
  logger.log(`  output:   ${values.output ?? '(default: output/<slug>.mp4)'}`);
  logger.log('  see PR #10 (e2e fixture) for the wired-up render path');
  return 0;
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
