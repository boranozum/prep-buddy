# tools/validate-data

CLI wrapper around the data validator and derived-data generator in
`packages/core/src/data` (kept pure there per CLAUDE.md "Pure core"; this
package does the file I/O). Ports `docs/examples/validate_examples.py`
(kept as a readable reference) plus every rule in `docs/data-model.md`
section 4 and the recipe authoring guide — see
`packages/core/src/data/validate-ingredient.ts` and `validate-recipe.ts`
for the semantic layer, and `schemas/*.schema.json` for the structural
layer.

```
tsx src/cli.ts validate [--ingredients=data/ingredients] [--recipes=data/recipes] [--strict=false]
tsx src/cli.ts generate [--ingredients=data/ingredients] [--recipes=data/recipes] [--out=data/generated/recipes]
```

`--strict=false` allows `source.dataset: example_placeholder` (used to
validate `docs/examples/` instead of `data/`; `data/` rejects it as an
error by default). `generate` refuses to run if validation found any
error. From the repo root: `pnpm data:validate` / `pnpm data:generate`.
