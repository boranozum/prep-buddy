// Integration test (allowed to do file I/O — this is a test, not library
// code): validates docs/examples/ end to end and checks the derived output
// against the fixture table in docs/recipe-authoring-guide.md section 17.
// This is the M1 acceptance test: "All three example recipes validate. The
// derived output equals the fixtures in docs/recipe-authoring-guide.md
// section 17."
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Ingredient } from '../generated/ingredient.js';
import type { Recipe } from '../generated/recipe.js';
import { deriveRecipeData } from './derive.js';
import type { Violation } from './types.js';
import { isError } from './types.js';
import { validateIngredientDoc } from './validate-ingredient.js';
import { validateRecipeDoc } from './validate-recipe.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const examplesDir = path.join(repoRoot, 'docs/examples');

function loadYamlDir(dir: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const fname of readdirSync(dir).sort()) {
    if (!fname.endsWith('.yaml')) continue;
    out.set(fname.slice(0, -'.yaml'.length), parse(readFileSync(path.join(dir, fname), 'utf-8')));
  }
  return out;
}

describe('docs/examples/ end to end', () => {
  const ingredients = new Map<string, Ingredient>();
  const recipes = new Map<string, Recipe>();
  const allViolations: Violation[] = [];

  beforeAll(() => {
    for (const [id, raw] of loadYamlDir(path.join(examplesDir, 'ingredients'))) {
      const result = validateIngredientDoc(raw, `ingredients/${id}`, {
        expectedId: id,
        rejectExamplePlaceholder: false,
      });
      allViolations.push(...result.violations);
      if (result.ingredient) ingredients.set(result.ingredient.id, result.ingredient);
    }
    for (const [id, raw] of loadYamlDir(path.join(examplesDir, 'recipes'))) {
      const result = validateRecipeDoc(raw, `recipes/${id}`, ingredients, { expectedId: id });
      allViolations.push(...result.violations);
      if (result.recipe) recipes.set(result.recipe.id, result.recipe);
    }
  });

  it('has 15 ingredients and 3 recipes', () => {
    expect(ingredients.size).toBe(15);
    expect(recipes.size).toBe(3);
  });

  it('has no validation errors (example_placeholder warnings are expected)', () => {
    const errors = allViolations.filter(isError);
    expect(errors).toEqual([]);
  });

  it.each([
    {
      id: 'chicken_pilaf',
      tasks: 13,
      per_serving: { kcal: 459.5, protein_g: 38.5, fat_g: 9.4, carbs_g: 51.8, fiber_g: 1.5 },
      active_min: 38.5,
      passive_min: 60.0,
      critical_path_min: 78.3,
      required_capabilities: ['heat_source', 'pan', 'pot'],
      allergens: [],
      diet_flags: ['contains_animal_product', 'contains_meat'],
    },
    {
      id: 'red_lentil_soup',
      tasks: 10,
      per_serving: { kcal: 304.5, protein_g: 15.9, fat_g: 7.2, carbs_g: 46.4, fiber_g: 8.5 },
      active_min: 33.3,
      passive_min: 50.0,
      critical_path_min: 79.9,
      required_capabilities: ['heat_source', 'pot'],
      allergens: [],
      diet_flags: [],
    },
    {
      id: 'sheet_pan_chicken_veg',
      tasks: 12,
      per_serving: { kcal: 471.1, protein_g: 43.9, fat_g: 16.3, carbs_g: 36.3, fiber_g: 6.2 },
      active_min: 34.7,
      passive_min: 92.0,
      critical_path_min: 83.0,
      required_capabilities: ['oven'],
      allergens: [],
      diet_flags: ['contains_animal_product', 'contains_meat'],
    },
  ])('$id derives the guide section 17 fixture', (expected) => {
    const recipe = recipes.get(expected.id);
    if (!recipe) throw new Error(`fixture recipe '${expected.id}' did not load`);
    const derived = deriveRecipeData(recipe, ingredients);

    expect(derived.tasks).toBe(expected.tasks);
    expect(derived.per_serving).toEqual(expected.per_serving);
    expect(derived.active_min).toBe(expected.active_min);
    expect(derived.passive_min).toBe(expected.passive_min);
    expect(derived.critical_path_min).toBe(expected.critical_path_min);
    expect(derived.required_capabilities).toEqual(expected.required_capabilities);
    expect(derived.allergens).toEqual(expected.allergens);
    expect(derived.diet_flags).toEqual(expected.diet_flags);
  });

  it('without an oven, sheet_pan_chicken_veg is the only recipe filtered out', () => {
    const kitCapabilities = new Set(['heat_source', 'pan', 'pot']); // no oven
    const available = [...recipes.values()].filter((r) => {
      const required = deriveRecipeData(r, ingredients).required_capabilities;
      return required.every((c) => kitCapabilities.has(c));
    });
    expect(available.map((r) => r.id).sort()).toEqual(['chicken_pilaf', 'red_lentil_soup']);
  });
});
