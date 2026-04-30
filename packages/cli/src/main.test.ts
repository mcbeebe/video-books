import { describe, expect, it } from 'vitest';
import { validChapterSpec } from '@video-books/types';
import { run } from './main.js';

function bufferLogger(): {
  logger: { log: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
  out: string[];
  err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    logger: {
      log: (...args) => out.push(args.map(String).join(' ')),
      error: (...args) => err.push(args.map(String).join(' ')),
    },
  };
}

describe('run (cli dispatch)', () => {
  it('prints help and returns 1 with no args', async () => {
    const { logger, out } = bufferLogger();
    const code = await run({ argv: ['node', 'wcap'], logger });
    expect(code).toBe(1);
    expect(out.join('\n')).toMatch(/Usage:/);
  });

  it('prints help and returns 0 with --help', async () => {
    const { logger, out } = bufferLogger();
    const code = await run({ argv: ['node', 'wcap', '--help'], logger });
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/Usage:/);
  });

  it('returns 1 with unknown command', async () => {
    const { logger, err } = bufferLogger();
    const code = await run({ argv: ['node', 'wcap', 'whatever'], logger });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/unknown command/);
  });

  it('validate prints summary on a valid spec', async () => {
    const { logger, out } = bufferLogger();
    const code = await run({
      argv: ['node', 'wcap', 'validate', 'unused.json'],
      logger,
      loadSpec: async () => validChapterSpec,
    });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/✓ /);
    expect(text).toMatch(validChapterSpec.slug);
    expect(text).toMatch(/scenes/);
  });

  it('validate returns 1 and prints the error message on invalid spec', async () => {
    const { logger, err } = bufferLogger();
    const code = await run({
      argv: ['node', 'wcap', 'validate', 'unused.json'],
      logger,
      loadSpec: async () => {
        throw new Error('schema mismatch: bad slug');
      },
    });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/schema mismatch/);
  });

  it('cost prints a formatted breakdown', async () => {
    const { logger, out } = bufferLogger();
    const code = await run({
      argv: ['node', 'wcap', 'cost', 'unused.json'],
      logger,
      loadSpec: async () => validChapterSpec,
    });
    expect(code).toBe(0);
    expect(out.join('\n')).toMatch(/Total:.*\$/);
  });

  it('render parses --max-cost / --confirm / --output flags', async () => {
    const { logger, out } = bufferLogger();
    const code = await run({
      argv: [
        'node',
        'wcap',
        'render',
        'spec.json',
        '--max-cost',
        '100',
        '--confirm',
        '--output',
        '/tmp/out.mp4',
      ],
      logger,
    });
    expect(code).toBe(0);
    const text = out.join('\n');
    expect(text).toMatch(/max-cost: 100/);
    expect(text).toMatch(/confirm:\s+true/);
    expect(text).toMatch(/output:\s+\/tmp\/out\.mp4/);
  });

  it('validate without a path returns 1 with usage', async () => {
    const { logger, err } = bufferLogger();
    const code = await run({ argv: ['node', 'wcap', 'validate'], logger });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/usage/);
  });

  it('cost without a path returns 1 with usage', async () => {
    const { logger, err } = bufferLogger();
    const code = await run({ argv: ['node', 'wcap', 'cost'], logger });
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/usage/);
  });
});
