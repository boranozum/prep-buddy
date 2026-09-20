// Semantic checks on top of the structural JSON Schema (schemas/recipe.schema.json):
// cross-references the structural layer can't express (task graph, ingredient
// usage, placeholder text, capability tiers). See docs/data-model.md section 4
// and docs/recipe-authoring-guide.md. Pure: takes already-parsed data (this
// recipe plus the caller's loaded ingredient library); does no file I/O.
import { capabilitiesConfig } from '../generated/config.js';
import type { Ingredient } from '../generated/ingredient.js';
import type { Method, Recipe, Task } from '../generated/recipe.js';
import { checkText } from './i18n.js';
import { ancestorsOf, buildTaskGraph, isAcyclic } from './recipe-graph.js';
import { validateRecipeSchema } from './schema-validators.js';
import type { Violation } from './types.js';

export interface RecipeValidationOptions {
  /** File name without extension — must equal the document's `id`. */
  expectedId: string;
}

export interface RecipeValidationResult {
  violations: Violation[];
  /** Present only if the document passed structural validation. */
  recipe?: Recipe;
}

const BASIC_CAPS = new Set<string>(capabilitiesConfig.basic);
const OPTIONAL_CAPS = new Set<string>(capabilitiesConfig.optional);
const KNOWN_CAPS = new Set<string>([...BASIC_CAPS, ...OPTIONAL_CAPS]);
const BATCH_KEY_RE = /^([a-z_]+):([a-z0-9_]+)$/;

function validateMethod(
  method: Method,
  task: Task,
  where: string,
  recipeIngredientIds: ReadonlySet<string>,
): Violation[] {
  const mw = `${where}/${method.id}`;
  const violations: Violation[] = [];
  const caps = new Set((method.requires ?? []).map((r) => r.capability));

  if (method.baseline) {
    const bad = [...caps].filter((c) => !BASIC_CAPS.has(c));
    if (bad.length > 0) {
      violations.push({
        where: mw,
        severity: 'error',
        message: `baseline method may only require basic capabilities, found ${JSON.stringify(bad.sort())}`,
      });
    }
  } else {
    if (![...caps].some((c) => OPTIONAL_CAPS.has(c))) {
      violations.push({
        where: mw,
        severity: 'warning',
        message: 'non-baseline method requires no optional appliance (why is it not the baseline?)',
      });
    }
    if (!method.text) {
      violations.push({
        where: mw,
        severity: 'warning',
        message:
          'accelerator method without its own text (fine only if the physical steps are identical)',
      });
    }
  }

  for (const c of caps) {
    if (!KNOWN_CAPS.has(c)) {
      violations.push({ where: mw, severity: 'error', message: `unknown capability '${c}'` });
    }
  }

  if (method.text) {
    violations.push(...checkText(method.text.brief, `${mw}:text.brief`, recipeIngredientIds));
    violations.push(...checkText(method.text.detailed, `${mw}:text.detailed`, recipeIngredientIds));
  }

  return violations;
}

function validateTask(
  task: Task,
  where: string,
  recipeIngredientIds: ReadonlySet<string>,
  tasksById: ReadonlyMap<string, Task>,
  producerOf: ReadonlyMap<string, string>,
  usedIngredients: Set<string>,
): Violation[] {
  const w = `${where}:${task.id}`;
  const violations: Violation[] = [];
  const ancestors = ancestorsOf(task.id, tasksById);

  for (const token of task.inputs) {
    if (recipeIngredientIds.has(token)) {
      usedIngredients.add(token);
    } else if (producerOf.has(token)) {
      const producerId = producerOf.get(token)!;
      if (!ancestors.has(producerId)) {
        violations.push({
          where: w,
          severity: 'error',
          message: `input '${token}' is not produced by an ancestor task`,
        });
      }
    } else {
      violations.push({
        where: w,
        severity: 'error',
        message: `input '${token}' is neither an ingredient nor an intermediate`,
      });
    }
  }

  if (task.batch_key) {
    const m = BATCH_KEY_RE.exec(task.batch_key);
    if (!m) {
      violations.push({
        where: w,
        severity: 'error',
        message: `batch_key '${task.batch_key}' must look like op:ingredient_id`,
      });
    } else {
      const [, op, ingredientId] = m;
      if (op !== task.op) {
        violations.push({
          where: w,
          severity: 'error',
          message: `batch_key op '${op}' differs from task op '${task.op}'`,
        });
      }
      if (!recipeIngredientIds.has(ingredientId!)) {
        violations.push({
          where: w,
          severity: 'error',
          message: `batch_key ingredient '${ingredientId}' is not in this recipe`,
        });
      }
    }
  }

  if (task.on_hold_exceeded) {
    violations.push(
      ...checkText(task.on_hold_exceeded.text, `${w}:on_hold_exceeded.text`, recipeIngredientIds),
    );
  }

  const baselines = task.methods.filter((m) => m.baseline);
  if (baselines.length !== 1) {
    violations.push({
      where: w,
      severity: 'error',
      message: `needs exactly one baseline method (found ${baselines.length})`,
    });
  }
  const methodIds = task.methods.map((m) => m.id);
  if (new Set(methodIds).size !== methodIds.length) {
    violations.push({ where: w, severity: 'error', message: 'duplicate method ids' });
  }
  for (const method of task.methods) {
    violations.push(...validateMethod(method, task, w, recipeIngredientIds));
  }

  violations.push(...checkText(task.text.brief, `${w}:text.brief`, recipeIngredientIds));
  violations.push(...checkText(task.text.detailed, `${w}:text.detailed`, recipeIngredientIds));

  return violations;
}

export function validateRecipeDoc(
  raw: unknown,
  where: string,
  ingredients: ReadonlyMap<string, Ingredient>,
  opts: RecipeValidationOptions,
): RecipeValidationResult {
  if (!validateRecipeSchema(raw)) {
    const violations: Violation[] = (validateRecipeSchema.errors ?? []).map((e) => ({
      where,
      severity: 'error',
      message: `${e.instancePath || '/'} ${e.message ?? 'invalid'}`,
    }));
    return { violations };
  }

  const recipe = raw;
  const violations: Violation[] = [];

  if (recipe.id !== opts.expectedId) {
    violations.push({
      where,
      severity: 'error',
      message: `file name must equal id (file implies '${opts.expectedId}', document has '${recipe.id}')`,
    });
  }

  const recipeIngredientIds = new Set(recipe.ingredients.map((l) => l.ingredient_id));
  for (const line of recipe.ingredients) {
    if (!ingredients.has(line.ingredient_id)) {
      violations.push({
        where,
        severity: 'error',
        message: `unknown ingredient '${line.ingredient_id}'`,
      });
    } else if (ingredients.get(line.ingredient_id)?.deprecated) {
      violations.push({ where, severity: 'error', message: `${line.ingredient_id} is deprecated` });
    }
    if (line.follows && !recipeIngredientIds.has(line.follows)) {
      violations.push({
        where,
        severity: 'error',
        message: `${line.ingredient_id}: follows unknown ingredient '${line.follows}'`,
      });
    }
  }

  const { min_factor, max_factor, flex } = recipe.scaling;
  if (!(min_factor < 1 && 1 <= max_factor)) {
    violations.push({
      where,
      severity: 'error',
      message: 'scaling needs min_factor < 1 <= max_factor',
    });
  }
  for (const fx of flex ?? []) {
    if (!recipeIngredientIds.has(fx.ingredient_id)) {
      violations.push({
        where,
        severity: 'error',
        message: `flex references unknown ingredient ${fx.ingredient_id}`,
      });
    }
    if (!(fx.min_factor < 1 && 1 <= fx.max_factor)) {
      violations.push({
        where,
        severity: 'error',
        message: `flex range for ${fx.ingredient_id} must contain 1`,
      });
    }
  }

  const taskIds = recipe.tasks.map((t) => t.id);
  if (new Set(taskIds).size !== taskIds.length) {
    violations.push({ where, severity: 'error', message: 'duplicate task ids' });
  }

  const graph = buildTaskGraph(recipe.tasks);
  for (const task of recipe.tasks) {
    for (const p of task.needs ?? []) {
      if (!graph.tasksById.has(p)) {
        violations.push({
          where,
          severity: 'error',
          message: `task ${task.id} needs unknown task '${p}'`,
        });
      }
    }
  }
  for (const dup of graph.duplicateOutputs) {
    violations.push({
      where,
      severity: 'error',
      message: `intermediate '${dup.output}' produced by two tasks (${dup.taskIds.join(', ')})`,
    });
  }

  if (!isAcyclic(graph.tasksById)) {
    violations.push({ where, severity: 'error', message: 'task graph has a cycle' });
    return { violations, recipe };
  }

  if (recipe.tasks.length < 3 || recipe.tasks.length > 25) {
    violations.push({
      where,
      severity: 'warning',
      message: `${recipe.tasks.length} tasks (guide suggests roughly 10-20)`,
    });
  }

  const usedIngredients = new Set<string>();
  for (const task of recipe.tasks) {
    violations.push(
      ...validateTask(
        task,
        where,
        recipeIngredientIds,
        graph.tasksById,
        graph.producerOf,
        usedIngredients,
      ),
    );
  }
  for (const id of recipeIngredientIds) {
    if (!usedIngredients.has(id)) {
      violations.push({
        where,
        severity: 'error',
        message: `ingredient '${id}' is never used by any task input`,
      });
    }
  }

  return { violations, recipe };
}
