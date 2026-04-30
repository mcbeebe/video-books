import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { validChapterSpec } from '@video-books/types';
import { parseChapterFile, validateSpec } from './parse.js';

describe('validateSpec', () => {
  it('accepts the canonical fixture', () => {
    expect(() => validateSpec(validChapterSpec)).not.toThrow();
  });

  it('returns the parsed spec with defaults applied', () => {
    const { output: _omit, ...withoutOutput } = validChapterSpec;
    const parsed = validateSpec(withoutOutput);
    expect(parsed.output).toEqual({ width: 1920, height: 1080, fps: 30 });
  });

  it('throws ZodError with .issues populated on bad input', () => {
    try {
      validateSpec({ slug: 'BAD SLUG', title: '', source: 'not-a-url', scenes: [] });
      expect.fail('expected validateSpec to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues.length).toBeGreaterThan(0);
    }
  });

  it('throws ZodError on a non-object input', () => {
    expect(() => validateSpec('definitely not a spec')).toThrow(ZodError);
  });
});

describe('parseChapterFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wcap-parse-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads and validates a valid spec file', async () => {
    const path = join(dir, 'spec.json');
    await writeFile(path, JSON.stringify(validChapterSpec), 'utf8');

    const spec = await parseChapterFile(path);

    expect(spec).toEqual(validChapterSpec);
  });

  it('handles trailing whitespace in the file', async () => {
    const path = join(dir, 'spec.json');
    await writeFile(path, `${JSON.stringify(validChapterSpec)}\n\n  \n`, 'utf8');

    const spec = await parseChapterFile(path);

    expect(spec.slug).toBe(validChapterSpec.slug);
  });

  it('throws ENOENT when the file does not exist', async () => {
    const path = join(dir, 'missing.json');
    await expect(parseChapterFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('throws SyntaxError when the file is not valid JSON', async () => {
    const path = join(dir, 'broken.json');
    await writeFile(path, '{ not json', 'utf8');
    await expect(parseChapterFile(path)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('throws SyntaxError on an empty file', async () => {
    const path = join(dir, 'empty.json');
    await writeFile(path, '', 'utf8');
    await expect(parseChapterFile(path)).rejects.toBeInstanceOf(SyntaxError);
  });

  it('throws ZodError when JSON is valid but the schema does not match', async () => {
    const path = join(dir, 'bad-spec.json');
    await writeFile(path, JSON.stringify({ slug: 'BAD', scenes: [] }), 'utf8');
    await expect(parseChapterFile(path)).rejects.toBeInstanceOf(ZodError);
  });
});
