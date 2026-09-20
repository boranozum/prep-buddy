# 001: M0 tooling choices

Status: accepted. Date: 2026-09-20.

## Context

`CLAUDE.md` sets tech defaults in general terms (pnpm workspaces, strict
TypeScript, Vitest, Python 3.12+ with `uv`, pytest, ruff, a type checker,
JSON Schema to TypeScript and Pydantic codegen). M0 needs concrete tool
choices and versions to scaffold the monorepo.

## Decisions

- **Package manager:** pnpm workspaces (`pnpm@12.5.1`, installed on the
  scaffolding machine). Workspace glob is `apps/*` and `packages/*` for
  now; `tools/*` packages are added to the glob as they gain a
  `package.json` (M1-M2).
- **Node:** 20.20.0 (current LTS), pinned in `.nvmrc` and `engines.node`
  in the root `package.json`.
- **TypeScript:** 5.6+, strict mode plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` and `verbatimModuleSyntax`, `module`/
  `moduleResolution` set to `ESNext`/`Bundler`. Config lives in
  `tsconfig.base.json`, extended per package.
- **Lint/format:** ESLint 9 flat config (`eslint.config.mjs`) with
  `typescript-eslint`'s recommended rules, plus `prettier --check` folded
  into `pnpm lint`. Prettier is scoped to code files; prose in `docs/**`
  and data in `data/**`/YAML are out of scope (validated separately by
  `tools/validate-data`, from M1).
- **TypeScript tests:** Vitest. `fast-check` is added in M2 when the
  scheduler needs property tests.
- **Python:** 3.12+, managed with `uv`. `services/solver/pyproject.toml`
  declares `pydantic` as the only runtime dependency for now; `fastapi`
  and `ortools` are added in M3 when the service has endpoints and a
  solver to run. Dev tools: `pytest`, `ruff`, `mypy` (strict, excluding
  `generated/`), `datamodel-code-generator`. `hypothesis` is added in M3
  alongside the verifier and solver property tests.
- **Schema codegen:** `json-schema-to-typescript` for
  `packages/core/src/generated/*.ts`, `datamodel-code-generator`
  (`pydantic_v2.BaseModel` output) for `services/solver/generated/*.py`.
  Both run from `scripts/generate-schemas.mjs` (`pnpm schemas:gen`).
  `pnpm schemas:check` (used in CI) regenerates into a scratch run and
  fails the build if the committed output differs, so a schema change
  can never ship without its generated code.
- **CI:** GitHub Actions, two jobs (`typescript`, `solver`) per
  `.github/workflows/ci.yml`. The conformance suite (`pnpm conformance`)
  and benchmark harness (`pnpm bench`) are stubs that pass trivially
  until M2 builds the scheduler and verifier they exercise.

## Consequences

- Adding a second schema means adding one entry to the `SCHEMAS` array in
  `scripts/generate-schemas.mjs` — no other wiring.
- `services/solver`'s dependency footprint stays small until M3, so `uv
  sync` in CI stays fast; OR-Tools' larger install is deferred until the
  service actually needs it.
- Prettier not touching `docs/**` means spec documents keep their
  hand-authored table formatting; only code is held to a formatter.
