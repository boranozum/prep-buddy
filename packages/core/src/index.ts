// Pure, side-effect-free core: expansion, batching, greedy scheduler,
// verifier, repair, rails, filtering, scaling, shopping list, estimators
// and text utilities. See CLAUDE.md "Conventions".
//
// Populated starting M1 (data validation, derived data, locale-aware text
// utilities) and M2 (scheduler).
export type { Ingredient } from './generated/ingredient.js';
export type { Method, Recipe, Task } from './generated/recipe.js';

export { deriveRecipeData } from './data/derive.js';
export type { DerivedRecipeData } from './data/derive.js';
export type { Severity, Violation } from './data/types.js';
export { isError } from './data/types.js';
export {
  validateIngredientDoc,
  type IngredientValidationOptions,
  type IngredientValidationResult,
} from './data/validate-ingredient.js';
export {
  validateRecipeDoc,
  type RecipeValidationOptions,
  type RecipeValidationResult,
} from './data/validate-recipe.js';

export {
  compareTurkish,
  foldForSearch,
  searchIngredients,
  turkishLowerCase,
  turkishUpperCase,
  type SearchableIngredient,
} from './text/locale.js';
