import { describe, expect, it } from 'vitest';
import { pickProvider } from './router.js';

describe('pickProvider', () => {
  it('routes HERO scenes to kling', () => {
    expect(pickProvider({ type: 'HERO' })).toBe('kling');
  });

  it('routes SCENE scenes to kling', () => {
    expect(pickProvider({ type: 'SCENE' })).toBe('kling');
  });
});
