// Task-graph helpers shared by validate-recipe.ts (acyclicity, ancestor
// checks) and derive.ts (mass basis, critical path). Pure: operates only on
// the Task list passed in.
import type { Task } from '../generated/recipe.js';

export interface TaskGraph {
  tasksById: ReadonlyMap<string, Task>;
  /** Intermediate/ingredient token -> id of the task whose `outputs` produced it. */
  producerOf: ReadonlyMap<string, string>;
  /** An output produced by more than one task (a schema-legal but semantically invalid recipe). */
  duplicateOutputs: Array<{ output: string; taskIds: string[] }>;
}

export function buildTaskGraph(tasks: readonly Task[]): TaskGraph {
  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  const producerOf = new Map<string, string>();
  const producedBy = new Map<string, string[]>();

  for (const task of tasks) {
    for (const output of task.outputs) {
      if (!producerOf.has(output)) {
        producerOf.set(output, task.id);
      }
      producedBy.set(output, [...(producedBy.get(output) ?? []), task.id]);
    }
  }

  const duplicateOutputs = [...producedBy.entries()]
    .filter(([, taskIds]) => taskIds.length > 1)
    .map(([output, taskIds]) => ({ output, taskIds }));

  return { tasksById, producerOf, duplicateOutputs };
}

/** Task ids that must finish before `taskId`, following only known tasks. */
export function ancestorsOf(taskId: string, tasksById: ReadonlyMap<string, Task>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(tasksById.get(taskId)?.needs ?? [])];
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (tasksById.has(p) && !seen.has(p)) {
      seen.add(p);
      stack.push(...(tasksById.get(p)?.needs ?? []));
    }
  }
  return seen;
}

export function isAcyclic(tasksById: ReadonlyMap<string, Task>): boolean {
  const UNVISITED = 0;
  const VISITING = 1;
  const DONE = 2;
  const state = new Map<string, 0 | 1 | 2>();

  function visit(id: string): boolean {
    const s = state.get(id) ?? UNVISITED;
    if (s === VISITING) return false;
    if (s === DONE) return true;
    state.set(id, VISITING);
    for (const p of tasksById.get(id)?.needs ?? []) {
      if (tasksById.has(p) && !visit(p)) return false;
    }
    state.set(id, DONE);
    return true;
  }

  return [...tasksById.keys()].every(visit);
}

/**
 * Recipe ingredient ids that a token (an ingredient id or an intermediate
 * produced by an earlier task) ultimately resolves to.
 */
export function sourcesOf(
  token: string,
  recipeIngredientIds: ReadonlySet<string>,
  graph: TaskGraph,
  cache: Map<string, ReadonlySet<string>> = new Map(),
): ReadonlySet<string> {
  const cached = cache.get(token);
  if (cached) return cached;

  let result: Set<string>;
  if (recipeIngredientIds.has(token)) {
    result = new Set([token]);
  } else {
    const producerId = graph.producerOf.get(token);
    const producerTask = producerId ? graph.tasksById.get(producerId) : undefined;
    result = new Set<string>();
    if (producerTask) {
      for (const input of producerTask.inputs) {
        for (const src of sourcesOf(input, recipeIngredientIds, graph, cache)) {
          result.add(src);
        }
      }
    }
  }
  cache.set(token, result);
  return result;
}

/** Total recipe-scoped grams behind a task's inputs (each source ingredient counted once). */
export function massOfTask(
  task: Task,
  recipeIngredientGrams: ReadonlyMap<string, number>,
  recipeIngredientIds: ReadonlySet<string>,
  graph: TaskGraph,
  cache?: Map<string, ReadonlySet<string>>,
): number {
  const sources = new Set<string>();
  for (const input of task.inputs) {
    for (const src of sourcesOf(input, recipeIngredientIds, graph, cache)) {
      sources.add(src);
    }
  }
  let total = 0;
  for (const id of sources) {
    total += recipeIngredientGrams.get(id) ?? 0;
  }
  return total;
}
