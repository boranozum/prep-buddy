#!/usr/bin/env -S node --import tsx
// The build validator for everything in data/ (docs/implementation-plan.md
// M1 task 2), plus the derived-data generator (M1 task 3). Both are thin CLI
// wrappers around the pure functions in @prep-buddy/core; see
// packages/core/src/data for the actual rules.
//
// Usage:
//   tsx src/cli.ts validate [--ingredients=data/ingredients] [--recipes=data/recipes] [--strict=false]
//   tsx src/cli.ts generate [--ingredients=data/ingredients] [--recipes=data/recipes] [--out=data/generated/recipes]
import { deriveRecipeData, isError, type Violation } from '@prep-buddy/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from './args.js';
import { validateAll } from './validate-all.js';

function printReport(violations: Violation[]): number {
  const errors = violations.filter(isError);
  const warnings = violations.filter((v) => !isError(v));
  for (const v of errors) console.error(`ERROR ${v.where}: ${v.message}`);
  for (const v of warnings) console.warn(`WARN  ${v.where}: ${v.message}`);
  return errors.length;
}

function main(): void {
  const [, , command, ...rest] = process.argv;
  const args = parseArgs(rest);
  const ingredientsDir = args['ingredients'] ?? 'data/ingredients';
  const recipesDir = args['recipes'] ?? 'data/recipes';
  const strict = args['strict'] !== 'false';

  if (command !== 'validate' && command !== 'generate') {
    console.error(
      'Usage: cli.ts <validate|generate> [--ingredients=DIR] [--recipes=DIR] [--out=DIR] [--strict=false]',
    );
    process.exit(2);
  }

  const { ingredients, recipes, violations } = validateAll(ingredientsDir, recipesDir, {
    rejectExamplePlaceholder: strict,
  });
  const errorCount = printReport(violations);
  console.log(
    `\n${ingredients.size} ingredients, ${recipes.size} recipes checked: ${errorCount} error(s), ${violations.length - errorCount} warning(s)`,
  );

  if (command === 'validate') {
    process.exit(errorCount > 0 ? 1 : 0);
  }

  // generate
  if (errorCount > 0) {
    console.error('\nRefusing to generate derived data: fix the validation errors above first.');
    process.exit(1);
  }
  const outDir = args['out'] ?? 'data/generated/recipes';
  mkdirSync(outDir, { recursive: true });
  for (const [id, recipe] of recipes) {
    const derived = deriveRecipeData(recipe, ingredients);
    const outPath = path.join(outDir, `${id}.json`);
    writeFileSync(outPath, `${JSON.stringify(derived, null, 2)}\n`);
    console.log(`wrote ${outPath}`);
  }
}

main();
