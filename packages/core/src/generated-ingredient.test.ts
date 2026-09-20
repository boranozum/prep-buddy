// Confirms the sample fixture validates against the JSON Schema (via ajv)
// and structurally matches the generated TypeScript type, proving the two
// codegen targets agree on one schema (M0 acceptance test). The Pydantic
// side of the same fixture is checked in
// services/solver/tests/test_ingredient_roundtrip.py.
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Ingredient } from './generated/ingredient.js';

const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const schema = JSON.parse(
  readFileSync(path.join(repoRoot, 'schemas/ingredient.schema.json'), 'utf-8'),
);
const fixture = JSON.parse(
  readFileSync(path.join(repoRoot, 'schemas/fixtures/sample-ingredient.json'), 'utf-8'),
) as Ingredient;

describe('generated Ingredient type', () => {
  it('accepts the sample fixture under the JSON Schema', () => {
    const ajv = new Ajv2020({ strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);

    expect(validate(fixture)).toBe(true);
  });

  it('exposes the fields docs/data-model.md section 3.1 requires', () => {
    expect(fixture.id).toBe('rice_white_long_raw');
    expect(fixture.names.en).toBe('White rice, long grain, raw');
    expect(fixture.per_100g.kcal).toBe(365);
  });
});
