import {describe, expect, it} from 'vitest';
import {nasaQueryVariants} from './wikimedia';

describe('licensed media search query routing', () => {
  it('broadens an over-specific cloud storyboard query for NASA Image Library', () => {
    expect(nasaQueryVariants('cloud formation water cycle evaporation condensation diagram')).toEqual([
      'cloud formation water cycle evaporation condensation diagram',
      'cumulus clouds atmosphere Earth',
    ]);
  });

  it('keeps the original query first and removes duplicate fallbacks', () => {
    const variants = nasaQueryVariants('cumulus clouds atmosphere Earth');
    expect(variants[0]).toBe('cumulus clouds atmosphere Earth');
    expect(new Set(variants).size).toBe(variants.length);
  });
});
