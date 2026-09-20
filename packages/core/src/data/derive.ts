// Derived recipe data: docs/data-model.md section 3.2 ("Derived fields").
// Computed here, written to data/generated/ by tools/validate-data (never
// hand-authored — the schema rejects these keys on the source document).
// Pure: assumes the recipe and ingredient library are already valid.
import type { Ingredient } from '../generated/ingredient.js';
import type { Duration, Method, Recipe, Task } from '../generated/recipe.js';
import { buildTaskGraph, massOfTask, type TaskGraph } from './recipe-graph.js';

export interface DerivedRecipeData {
  per_serving: { kcal: number; protein_g: number; fat_g: number; carbs_g: number; fiber_g: number };
  allergens: string[];
  diet_flags: string[];
  required_capabilities: string[];
  tasks: number;
  active_min: number;
  passive_min: number;
  /** Ignores resource contention — the reference cook's own critical path. */
  critical_path_min: number;
}

const MACRO_KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g'] as const;

function baselineOf(task: Task): Method {
  const m = task.methods.find((method) => method.baseline);
  if (!m)
    throw new Error(`task '${task.id}' has no baseline method (should have failed validation)`);
  return m;
}

function durationOf(duration: Duration | undefined, mass: number): number {
  if (!duration) return 0;
  const fixed = duration.fixed_min ?? 0;
  const per100g = duration.per_100g_min ?? 0;
  const scales = duration.scales ?? true;
  return fixed + (scales ? (per100g * mass) / 100 : 0);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function criticalPathMin(
  recipe: Recipe,
  graph: TaskGraph,
  ingredientGrams: ReadonlyMap<string, number>,
  ingredientIds: ReadonlySet<string>,
): number {
  const finishByTask = new Map<string, number>();
  const massCache = new Map<string, ReadonlySet<string>>();

  function finish(taskId: string): number {
    const cached = finishByTask.get(taskId);
    if (cached !== undefined) return cached;
    const task = graph.tasksById.get(taskId)!;
    const method = baselineOf(task);
    const mass = massOfTask(task, ingredientGrams, ingredientIds, graph, massCache);
    const start = Math.max(0, ...(task.needs ?? []).map(finish));
    const result = start + durationOf(method.active, mass) + durationOf(method.passive, mass);
    finishByTask.set(taskId, result);
    return result;
  }

  return Math.max(...recipe.tasks.map((t) => finish(t.id)));
}

export function deriveRecipeData(
  recipe: Recipe,
  ingredients: ReadonlyMap<string, Ingredient>,
): DerivedRecipeData {
  const totals = { kcal: 0, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0 };
  const allergens = new Set<string>();
  const dietFlags = new Set<string>();
  const ingredientGrams = new Map<string, number>();
  const ingredientIds = new Set(recipe.ingredients.map((l) => l.ingredient_id));

  for (const line of recipe.ingredients) {
    const ingredient = ingredients.get(line.ingredient_id);
    if (!ingredient)
      throw new Error(`unknown ingredient '${line.ingredient_id}' (should have failed validation)`);
    ingredientGrams.set(line.ingredient_id, line.grams);
    for (const key of MACRO_KEYS) {
      totals[key] += (ingredient.per_100g[key] * line.grams) / 100;
    }
    for (const a of ingredient.allergens) allergens.add(a);
    for (const f of ingredient.diet_flags) dietFlags.add(f);
  }

  const perServing = Object.fromEntries(
    MACRO_KEYS.map((key) => [key, round1(totals[key] / recipe.base_servings)]),
  ) as DerivedRecipeData['per_serving'];

  const graph = buildTaskGraph(recipe.tasks);
  const requiredCapabilities = new Set<string>();
  let activeMin = 0;
  let passiveMin = 0;
  const massCache = new Map<string, ReadonlySet<string>>();
  for (const task of recipe.tasks) {
    const method = baselineOf(task);
    for (const req of method.requires ?? []) requiredCapabilities.add(req.capability);
    const mass = massOfTask(task, ingredientGrams, ingredientIds, graph, massCache);
    activeMin += durationOf(method.active, mass);
    passiveMin += durationOf(method.passive, mass);
  }

  return {
    per_serving: perServing,
    allergens: [...allergens].sort(),
    diet_flags: [...dietFlags].sort(),
    required_capabilities: [...requiredCapabilities].sort(),
    tasks: recipe.tasks.length,
    active_min: round1(activeMin),
    passive_min: round1(passiveMin),
    critical_path_min: round1(criticalPathMin(recipe, graph, ingredientGrams, ingredientIds)),
  };
}
