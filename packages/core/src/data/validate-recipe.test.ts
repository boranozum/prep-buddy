import { describe, expect, it } from 'vitest';
import type { Ingredient } from '../generated/ingredient.js';
import { validIngredientDoc, validRecipeDoc } from './testing/fixtures.js';
import { validateIngredientDoc } from './validate-ingredient.js';
import { validateRecipeDoc } from './validate-recipe.js';

function ingredientLibrary(): Map<string, Ingredient> {
  const result = validateIngredientDoc(validIngredientDoc(), 'ingredients/carrot_raw', {
    expectedId: 'carrot_raw',
    rejectExamplePlaceholder: true,
  });
  if (!result.ingredient) throw new Error('fixture ingredient failed validation');
  return new Map([[result.ingredient.id, result.ingredient]]);
}

function validate(raw: unknown, ingredients = ingredientLibrary()) {
  return validateRecipeDoc(raw, 'recipes/test_recipe', ingredients, { expectedId: 'test_recipe' });
}

describe('validateRecipeDoc', () => {
  it('accepts the valid fixture with no violations', () => {
    const result = validate(validRecipeDoc());
    expect(result.violations).toEqual([]);
    expect(result.recipe?.id).toBe('test_recipe');
  });

  it('rejects a dependency cycle', () => {
    const doc = validRecipeDoc() as { tasks: Array<{ id: string; needs: string[] }> };
    // wash_carrot <- cook_carrot, closing the chain into a cycle.
    doc.tasks[0]!.needs = ['cook_carrot'];
    const result = validate(doc);
    expect(result.violations.some((v) => v.message.includes('cycle'))).toBe(true);
  });

  it('rejects an accelerator method marked as baseline (requires a non-basic capability)', () => {
    const doc = validRecipeDoc() as {
      tasks: Array<{
        methods: Array<{ baseline?: boolean; requires: Array<{ capability: string }> }>;
      }>;
    };
    doc.tasks[2]!.methods[0]!.requires.push({ capability: 'pressure_cooker' });
    const result = validate(doc);
    expect(
      result.violations.some((v) => v.message.includes('baseline method may only require basic')),
    ).toBe(true);
  });

  it('rejects a batch_key whose op does not match the task op', () => {
    const doc = validRecipeDoc() as { tasks: Array<{ batch_key?: string }> };
    doc.tasks[1]!.batch_key = 'slice:carrot_raw'; // task op is 'dice'
    const result = validate(doc);
    expect(result.violations.some((v) => v.message.includes('batch_key op'))).toBe(true);
  });

  it('rejects a safety hold with a bad on_hold_exceeded.action', () => {
    const doc = validRecipeDoc() as {
      tasks: Array<Record<string, unknown>>;
    };
    doc.tasks[0]!.hold_max_min = 20;
    doc.tasks[0]!.hold_kind = 'safety';
    doc.tasks[0]!.on_hold_exceeded = {
      action: 'not_a_real_action',
      text: { en: 'Do something.', tr: 'Bir şey yapın.' },
    };
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects hold_max_min without hold_kind', () => {
    const doc = validRecipeDoc() as { tasks: Array<Record<string, unknown>> };
    doc.tasks[0]!.hold_max_min = 10;
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects a continuity hold longer than 5 minutes', () => {
    const doc = validRecipeDoc() as { tasks: Array<Record<string, unknown>> };
    doc.tasks[0]!.hold_max_min = 6;
    doc.tasks[0]!.hold_kind = 'continuity';
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('rejects an orphan recipe ingredient (never used by any task input)', () => {
    const doc = validRecipeDoc() as {
      ingredients: Array<{ ingredient_id: string; grams: number; role: string }>;
    };
    const salt: Ingredient = {
      schema_version: 1,
      id: 'salt_table',
      names: { en: 'Salt', tr: 'Tuz' },
      per_100g: { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 },
      allergens: [],
      diet_flags: [],
      shopping: { section: 'spices_oils', pack_sizes_g: [500], staple: true },
      source: { dataset: 'usda_foundation', fdc_id: 1, snapshot_date: '2026-01-01' },
    };
    doc.ingredients.push({ ingredient_id: 'salt_table', grams: 5, role: 'seasoning' }); // never used by a task
    const ingredients = ingredientLibrary();
    ingredients.set('salt_table', salt);
    const result = validate(doc, ingredients);
    expect(
      result.violations.some((v) => v.message.includes('is never used by any task input')),
    ).toBe(true);
  });

  it('rejects an unproduced intermediate (input neither an ingredient nor produced)', () => {
    const doc = validRecipeDoc() as { tasks: Array<{ inputs: string[] }> };
    doc.tasks[1]!.inputs = ['some_intermediate_nobody_made'];
    const result = validate(doc);
    expect(
      result.violations.some((v) =>
        v.message.includes('is neither an ingredient nor an intermediate'),
      ),
    ).toBe(true);
  });

  it('rejects a published recipe with no reviewer for a required locale', () => {
    const doc = validRecipeDoc() as {
      status: string;
      authoring: { reviewed_by: Record<string, string> };
    };
    doc.status = 'published';
    doc.authoring.reviewed_by = { en: 'Jane' }; // missing tr
    expect(validate(doc).violations.length).toBeGreaterThan(0);
  });

  it('accepts a published recipe with a reviewer for every required locale', () => {
    const doc = validRecipeDoc() as {
      status: string;
      authoring: { reviewed_by: Record<string, string> };
    };
    doc.status = 'published';
    doc.authoring.reviewed_by = { en: 'Jane', tr: 'Ayşe' };
    expect(validate(doc).violations).toEqual([]);
  });

  it('rejects a raw amount in instruction text instead of a placeholder', () => {
    const doc = validRecipeDoc() as { tasks: Array<{ text: { detailed: { en: string } } }> };
    doc.tasks[0]!.text.detailed.en = 'Wash 200 g of carrot under cold water.';
    const result = validate(doc);
    expect(result.violations.some((v) => v.message.includes('raw amount/temperature/length'))).toBe(
      true,
    );
  });

  it('rejects placeholders that differ between locales', () => {
    const doc = validRecipeDoc() as {
      tasks: Array<{ text: { detailed: { en: string; tr: string } } }>;
    };
    doc.tasks[0]!.text.detailed.en = 'Wash {qty:carrot_raw} of carrot.';
    // tr side has no placeholder at all.
    doc.tasks[0]!.text.detailed.tr = 'Havucu yıkayın.';
    const result = validate(doc);
    expect(
      result.violations.some((v) => v.message.includes('placeholders differ between locales')),
    ).toBe(true);
  });
});
