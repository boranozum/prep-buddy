// Semantic checks on top of the structural JSON Schema (schemas/ingredient.schema.json).
// See docs/data-model.md section 4. Pure: takes already-parsed data and a
// couple of caller-supplied facts (the expected id, whether to reject
// `example_placeholder`); does no file I/O.
import type { Ingredient } from '../generated/ingredient.js';
import { validateIngredientSchema } from './schema-validators.js';
import type { Violation } from './types.js';

export interface IngredientValidationOptions {
  /** File name without extension — must equal the document's `id`. */
  expectedId: string;
  /**
   * `data/` rejects `source.dataset: example_placeholder` as an error;
   * `docs/examples/` allows it (and the caller may still want a warning).
   */
  rejectExamplePlaceholder: boolean;
}

export interface IngredientValidationResult {
  violations: Violation[];
  /** Present only if the document passed structural validation. */
  ingredient?: Ingredient;
}

function checkKcalPlausibility(ingredient: Ingredient, where: string): Violation[] {
  const { kcal, protein_g, fat_g, carbs_g } = ingredient.per_100g;
  const estimate = 4 * protein_g + 4 * carbs_g + 9 * fat_g;
  const exempt = ingredient.validation?.kcal_check === 'exempt';

  const violations: Violation[] = [];
  if (!exempt && estimate > 5 && Math.abs(estimate - kcal) > 0.1 * Math.max(kcal, 1)) {
    violations.push({
      where,
      severity: 'error',
      message: `kcal ${kcal} vs 4P+4C+9F=${estimate.toFixed(0)} differs by more than 10% (add a validation exemption with a reason if justified)`,
    });
  }
  if (exempt && !ingredient.validation?.reason) {
    violations.push({ where, severity: 'error', message: 'kcal_check exemption needs a reason' });
  }
  return violations;
}

export function validateIngredientDoc(
  raw: unknown,
  where: string,
  opts: IngredientValidationOptions,
): IngredientValidationResult {
  if (!validateIngredientSchema(raw)) {
    const violations: Violation[] = (validateIngredientSchema.errors ?? []).map((e) => ({
      where,
      severity: 'error',
      message: `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    }));
    return { violations };
  }

  const ingredient = raw;
  const violations: Violation[] = [];

  if (ingredient.id !== opts.expectedId) {
    violations.push({
      where,
      severity: 'error',
      message: `file name must equal id (file implies '${opts.expectedId}', document has '${ingredient.id}')`,
    });
  }

  if (ingredient.source.dataset === 'example_placeholder') {
    violations.push({
      where,
      severity: opts.rejectExamplePlaceholder ? 'error' : 'warning',
      message: 'example_placeholder source (allowed only under docs/examples; rejected in data/)',
    });
  }

  violations.push(...checkKcalPlausibility(ingredient, where));

  return { violations, ingredient };
}
