#!/usr/bin/env node
// CI guard: regenerates codegen output and fails if it differs from what's
// committed, so a schema change can never ship without its generated code.
import { execFileSync } from 'node:child_process';

execFileSync('node', ['scripts/generate-schemas.mjs'], { stdio: 'inherit' });

try {
  execFileSync(
    'git',
    ['diff', '--exit-code', '--', 'packages/core/src/generated', 'services/solver/generated'],
    { stdio: 'inherit' },
  );
} catch {
  console.error(
    '\nGenerated code is out of date with schemas/*.schema.json.\n' +
      'Run `pnpm schemas:gen` and commit the result.',
  );
  process.exit(1);
}

console.log('Generated code is up to date.');
