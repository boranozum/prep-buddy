import type { Ingredient, Recipe, Violation } from '@prep-buddy/core';
import { validateIngredientDoc, validateRecipeDoc } from '@prep-buddy/core';
import { loadYamlDir } from './load.js';

export interface ValidateAllResult {
  ingredients: Map<string, Ingredient>;
  recipes: Map<string, Recipe>;
  violations: Violation[];
}

export interface ValidateAllOptions {
  /** false for docs/examples, true for data/ (CLAUDE.md rule 9 / data-model.md 4). */
  rejectExamplePlaceholder: boolean;
}

export function validateAll(
  ingredientsDir: string,
  recipesDir: string,
  opts: ValidateAllOptions,
): ValidateAllResult {
  const ingredients = new Map<string, Ingredient>();
  const recipes = new Map<string, Recipe>();
  const violations: Violation[] = [];

  for (const [id, raw] of loadYamlDir(ingredientsDir)) {
    const result = validateIngredientDoc(raw, `ingredients/${id}`, {
      expectedId: id,
      rejectExamplePlaceholder: opts.rejectExamplePlaceholder,
    });
    violations.push(...result.violations);
    if (result.ingredient) ingredients.set(result.ingredient.id, result.ingredient);
  }

  for (const [id, raw] of loadYamlDir(recipesDir)) {
    const result = validateRecipeDoc(raw, `recipes/${id}`, ingredients, { expectedId: id });
    violations.push(...result.violations);
    if (result.recipe) recipes.set(result.recipe.id, result.recipe);
  }

  return { ingredients, recipes, violations };
}
