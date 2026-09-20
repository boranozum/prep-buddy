// Ajv instance and compiled validators shared by validate-ingredient.ts and
// validate-recipe.ts. The schema objects are generated (see
// scripts/generate-schemas.mjs) from schemas/*.schema.json, so this module
// never touches the filesystem itself.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { ingredientJsonSchema } from '../generated/ingredient.schema.js';
import type { Ingredient } from '../generated/ingredient.js';
import { recipeJsonSchema } from '../generated/recipe.schema.js';
import type { Recipe } from '../generated/recipe.js';

// strictRequired is disabled because the recipe schema's conditional (if/then)
// branches use `required` on properties that are declared once, at the top
// level of $defs, rather than re-declared inside every branch that requires
// them — which ajv's strict mode otherwise flags as a possible typo.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
addFormats(ajv);

export const validateIngredientSchema = ajv.compile<Ingredient>(ingredientJsonSchema);
export const validateRecipeSchema = ajv.compile<Recipe>(recipeJsonSchema);
