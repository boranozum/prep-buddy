import { describe, expect, it } from 'vitest';
import { compareTurkish, foldForSearch, searchIngredients } from './locale.js';

const semolina = {
  id: 'semolina_raw',
  names: { en: 'Semolina, raw', tr: 'İrmik, çiğ' },
  aliases: { en: ['semolina', 'durum wheat semolina'], tr: ['irmik'] },
};
const rice = {
  id: 'rice_white_long_raw',
  names: { en: 'White rice, long grain, raw', tr: 'Pirinç, uzun taneli, çiğ' },
  aliases: { en: ['rice', 'long grain rice'], tr: ['pirinç', 'pilavlık pirinç'] },
};
const ingredients = [semolina, rice];

describe('foldForSearch', () => {
  it('treats Turkish dotless ı and ASCII I as equivalent', () => {
    expect(foldForSearch('IRMIK')).toBe(foldForSearch('ırmık'));
  });

  it('treats Turkish dotted İ and lowercase i as equivalent', () => {
    expect(foldForSearch('İSTANBUL')).toBe(foldForSearch('istanbul'));
  });

  it('does not corrupt plain English text (the classic Turkish-locale-casing bug)', () => {
    expect(foldForSearch('RICE')).toBe(foldForSearch('rice'));
    expect(foldForSearch('Long Grain Rice')).toBe('long grain rice');
  });
});

describe('searchIngredients', () => {
  it('matches a Turkish alias from an ASCII-typed query (IRMIK matches ırmık)', () => {
    const results = searchIngredients('IRMIK', ingredients);
    expect(results.map((r) => r.id)).toEqual(['semolina_raw']);
  });

  it('finds a Turkish-named ingredient via its English alias', () => {
    const results = searchIngredients('semolina', ingredients);
    expect(results.map((r) => r.id)).toEqual(['semolina_raw']);
  });

  it('matches on a partial, case-insensitive substring', () => {
    const results = searchIngredients('rıce', ingredients); // dotless ı, as a Turkish keyboard might type
    expect(results.map((r) => r.id)).toEqual(['rice_white_long_raw']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchIngredients('   ', ingredients)).toEqual([]);
  });
});

describe('compareTurkish', () => {
  it('sorts Turkish words using Turkish collation order', () => {
    const words = ['çiğ', 'armut', 'ırmık'];
    expect([...words].sort(compareTurkish)).toEqual(['armut', 'çiğ', 'ırmık']);
  });
});
