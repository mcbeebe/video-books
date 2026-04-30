import { describe, expect, it } from 'vitest';
import { hello } from './index.js';

describe('hello', () => {
  it('greets the given name', () => {
    expect(hello('world')).toBe('hello, world');
  });

  it('handles empty string', () => {
    expect(hello('')).toBe('hello, ');
  });
});
