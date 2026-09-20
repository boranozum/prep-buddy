# Schema fixtures

Sample documents used only to test that the generated TypeScript types and
Pydantic models agree on the same input (see `scripts/generate-schemas.mjs`
and the round-trip tests in `packages/core` and `services/solver`).

These are **not** reviewed content and must never be copied into `data/`.
`sample-ingredient.json` reuses the illustrative numbers from
`docs/examples/ingredients/rice_white_long_raw.yaml`.
