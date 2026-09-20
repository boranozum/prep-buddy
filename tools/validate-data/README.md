# tools/validate-data

The build validator for everything in `data/`. Implemented in M1 by
porting `docs/examples/validate_examples.py` and covering every rule in
`docs/data-model.md` section 4 and the recipe authoring guide.

Until then, `pnpm data:validate` runs the M0 prototype validator against
`docs/examples/` instead.
