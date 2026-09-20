# 002: M1 data pipeline decisions

Status: accepted. Date: 2026-09-20.

## Context

`docs/implementation-plan.md` M1 asks for: finalized ingredient/recipe/task/
method/capabilities/diet-rules/locales schemas, a build validator ported
from `docs/examples/validate_examples.py`, a derived-data generator, locale-
aware text utilities with cross-language search, and moving the example
recipes/ingredients "into a staging area (`data/` is for real, reviewed
data only)". A few points needed a call during implementation.

## Decisions

- **`docs/examples/` stays where it is; nothing moved.** It already serves
  exactly the "staging area, not `data/`" role the plan describes — it was
  established in M0 as the fixture set, and `docs/README.md` already
  documents it that way. Reinterpreted the task as: keep `docs/examples/`
  as the non-shipped fixture set, and make sure `data/` itself rejects
  `source.dataset: example_placeholder` as an error (it does — see
  `IngredientValidationOptions.rejectExamplePlaceholder`, defaulted to
  `true` for `data/` and `false` for `docs/examples/`).
- **JSON Schema does more than the prototype validator did.** The
  prototype (no schema layer existed yet) checked everything by hand.
  Now that `schemas/ingredient.schema.json` and `schemas/recipe.schema.json`
  exist, several of its checks are structural: enum values (allergens,
  diet flags, shopping sections, hold actions/kinds), non-empty locales
  and alias lists, `edible_fraction`/`portion_step_g`/`mass_factor` ranges,
  `hold_max_min` requiring `hold_kind` (`dependentRequired`), a `safety`
  hold requiring `on_hold_exceeded` and a `continuity` hold capping at 5
  minutes (`if`/`then`), an `oven` requirement needing `temp_c`/
  `tolerance_c`/`trays`, and a `published` recipe needing a reviewer for
  both locales. `packages/core/src/data/validate-recipe.ts` and
  `validate-ingredient.ts` only implement what the schema can't: task-graph
  acyclicity and ancestor-production, ingredient existence and
  deprecation, scaling/flex ranges, batch-key op/ingredient matching,
  placeholder grammar and cross-locale consistency, baseline capability
  tier, and kcal plausibility. This keeps with `docs/data-model.md`
  principle 1 ("JSON Schema is the single source of truth") and section 4's
  two-layer split (structural, then semantic).
- **`schemas/*.json` (non-`*.schema.json`) are wrapped as generated TS
  constants**, not read from disk at runtime. `packages/core` must stay
  pure/I/O-free (CLAUDE.md "Pure core"), so `scripts/generate-schemas.mjs`
  now also emits `packages/core/src/generated/config.ts` (from
  `locales.json`, `capabilities.json`, `diet-rules.json`) and
  `*.schema.ts` wrappers around the two JSON schemas (for the ajv
  validators to compile from a static import instead of a file read). All
  file I/O for the data pipeline lives in `tools/validate-data`.
- **`schemas/diet-rules.json` is a hypothesis, not reviewed content.**
  Diet logic is a CLAUDE.md "sensitive area" needing human/dietitian
  review before it drives any filtering; the file says so in its
  `$comment` and nothing in M1 reads it yet (M4 planning layer will).
- **`tools/validate-data` is a thin CLI over pure functions in
  `packages/core/src/data`.** `validate` and `generate` subcommands, run
  via `tsx`; `pnpm data:validate` / `pnpm data:generate` from the repo
  root. `generate` refuses to run if validation found any error.
- **The M0 prototype (`docs/examples/validate_examples.py`) stays as a
  reference** (per its own docstring) but is no longer wired into CI;
  `packages/core/src/data/examples.test.ts` now exercises the same
  fixtures through the real validator and asserts the derived output
  against the exact table in `docs/recipe-authoring-guide.md` section 17.

## Consequences

- Adding a data rule usually means asking "can the schema say this?"
  first — cheaper to maintain and gives clearer error locations than
  adding another hand-written check.
- `data/` is still empty; M1 proves the pipeline against `docs/examples/`.
  Real content arrives in M8 and will exercise `pnpm data:validate` /
  `pnpm data:generate` against `data/` for the first time.
