import { readFile } from 'node:fs/promises';
import { ChapterSpecSchema, type ChapterSpec } from '@video-books/types';

/**
 * Validate an unknown value against the `ChapterSpec` schema. Pure — no IO.
 * Throws on shape mismatch; the thrown error is a `ZodError` whose `.issues`
 * array contains every problem found in the input (Zod surfaces all errors
 * at once, per architecture §6.1).
 *
 * @param input - Any value, typically the result of `JSON.parse`.
 * @returns A typed `ChapterSpec` (with default `output` fields applied).
 * @throws {import('zod').ZodError} when `input` does not match the schema.
 * @example
 *   const spec = validateSpec(JSON.parse(text));
 */
export function validateSpec(input: unknown): ChapterSpec {
  return ChapterSpecSchema.parse(input);
}

/**
 * Read a chapter spec JSON file from disk, parse it, and validate against
 * `ChapterSpecSchema`. The single entrypoint downstream packages should use
 * to load a spec.
 *
 * @param path - File path (absolute or relative to `process.cwd()`).
 * @returns A typed `ChapterSpec`.
 * @throws {NodeJS.ErrnoException} when the file cannot be read (e.g. `ENOENT`).
 * @throws {SyntaxError} when the file contents are not valid JSON.
 * @throws {import('zod').ZodError} when the JSON does not match the schema.
 * @example
 *   const spec = await parseChapterFile('content/chapters/chapter-6.spec.json');
 */
export async function parseChapterFile(path: string): Promise<ChapterSpec> {
  const text = await readFile(path, 'utf8');
  const json: unknown = JSON.parse(text);
  return validateSpec(json);
}
