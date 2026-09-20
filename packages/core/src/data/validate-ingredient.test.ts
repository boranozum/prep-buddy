import { describe, expect, it } from 'vitest';
import { validIngredientDoc } from './testing/fixtures.js';
import { validateIngredientDoc } from './validate-ingredient.js';

function validate(raw: unknown, opts: { rejectExamplePlaceholder?: boolean } = {}) {
  return validateIngredientDoc(raw, 'ingredients/carrot_raw', {
    expectedId: 'carrot_raw',
    rejectExamplePlaceholder: opts.rejectExamplePlaceholder ?? true,
  });
}

describe('validateIngredientDoc', () => {
  it('accepts the valid fixture with no violations', () => {
    const result = validate(validIngredientDoc());
    expect(result.violations).toEqual([]);
    expect(result.ingredient?.id).toBe('carrot_raw');
  });

  it('rejects an empty locale (structural: I18nString minLength)', () => {
    const doc = validIngredientDoc() as { names: { en: string } };
    doc.names.en = '';
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects a file name that does not match id', () => {
    const result = validateIngredientDoc(validIngredientDoc(), 'ingredients/onion_yellow_raw', {
      expectedId: 'onion_yellow_raw',
      rejectExamplePlaceholder: true,
    });
    expect(result.violations.some((v) => v.message.includes('file name must equal id'))).toBe(true);
  });

  it('rejects example_placeholder source in strict (data/) mode', () => {
    const doc = validIngredientDoc() as { source: { dataset: string } };
    doc.source.dataset = 'example_placeholder';
    const result = validate(doc, { rejectExamplePlaceholder: true });
    expect(
      result.violations.some(
        (v) => v.severity === 'error' && v.message.includes('example_placeholder'),
      ),
    ).toBe(true);
  });

  it('only warns about example_placeholder source outside data/ (docs/examples)', () => {
    const doc = validIngredientDoc() as { source: { dataset: string } };
    doc.source.dataset = 'example_placeholder';
    const result = validate(doc, { rejectExamplePlaceholder: false });
    const placeholderViolations = result.violations.filter((v) =>
      v.message.includes('example_placeholder'),
    );
    expect(placeholderViolations).toHaveLength(1);
    expect(placeholderViolations[0]?.severity).toBe('warning');
  });

  it('rejects implausible kcal without an exemption', () => {
    const doc = validIngredientDoc() as { per_100g: { kcal: number } };
    doc.per_100g.kcal = 900; // 4P+4C+9F is nowhere near this
    expect(
      validate(doc).violations.some((v) => v.message.includes('differs by more than 10%')),
    ).toBe(true);
  });

  it('accepts implausible kcal with a validation exemption and a reason', () => {
    const doc = validIngredientDoc() as { per_100g: { kcal: number }; validation?: unknown };
    doc.per_100g.kcal = 900;
    doc.validation = { kcal_check: 'exempt', reason: 'concentrated extract' };
    expect(validate(doc).violations).toEqual([]);
  });

  it('rejects a kcal exemption with no reason (structural: reason minLength)', () => {
    const doc = validIngredientDoc() as { validation?: unknown };
    doc.validation = { kcal_check: 'exempt', reason: '' };
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects an empty alias list (structural: I18nStringArray minItems)', () => {
    const doc = validIngredientDoc() as { aliases: { en: string[] } };
    doc.aliases.en = [];
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects an unknown allergen (structural: enum)', () => {
    const doc = validIngredientDoc() as { allergens: string[] };
    doc.allergens = ['not_a_real_allergen'];
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });
});
