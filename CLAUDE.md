# CLAUDE.md

Guidance for Claude Code working in the Prep Buddy repository. Keep this file short and current. Details live in `docs/`.

## What this is

Prep Buddy is a mobile app that acts as a cooking coach for **batch meal prep**. The user picks several recipes, and the app computes **one optimized cooking session** (what to batch, what to start first, what to do while something roasts) and walks them through it step by step, with timers, until everything is cooked, portioned and stored. It also handles calorie and macro targets, allergies, a shopping list and simple tracking.

**Current milestone:** M1 (see `docs/implementation-plan.md`). M0 (foundations: monorepo, CI, schema codegen) is done. Update this line as milestones complete.

## Read first

1. `docs/PRD.md`: scope, principles, non-goals, decisions.
2. `docs/implementation-plan.md`: milestones, acceptance tests, gates. Build in that order (riskiest first: scheduler before UI).
3. The document for the area you touch:
   - `docs/data-model.md`: schemas and entities
   - `docs/scheduler-spec.md`: expansion, batching, solver, verifier, greedy, repair, speed estimator
   - `docs/planning-spec.md`: targets, safety rails, filtering, scaling, shopping list, tracking
   - `docs/cook-mode-spec.md`: state machine, timers, notifications, wrap-up
   - `docs/recipe-authoring-guide.md` and `docs/examples/`: how content is authored, with worked fixtures

## Repository layout

```
apps/mobile/        Expo React Native app (TypeScript)
services/solver/    Python service: FastAPI + OR-Tools CP-SAT, and the Python verifier
packages/core/      Shared pure TypeScript: expansion, batching, greedy scheduler, verifier,
                    repair, rails, filtering, scaling, shopping list, estimators, text utilities
data/               Reviewed ingredients and recipes (YAML), plus generated derived data
schemas/            JSON Schema (single source of truth) and conformance/ test cases
tools/              CLI tools: data validator, plan viewer, benchmarks
docs/               Specs, guide, examples, decisions/ (ADRs), reports/
```

## Non-negotiable rules

These come from the PRD principles. Do not relax them without an explicit PRD change.

1. **Deterministic scheduling with an independent verifier.** Plans come from algorithms, never from an LLM. **Every plan** (solver, greedy, repair) passes the verifier before it is shown. Never display an unverified or failed plan.
2. **Nutrition is never guessed.** Macros come from the canonical ingredient table only. Never write or infer nutrition, allergen, diet, or food-safety values from model memory.
3. **Safety rails cannot be bypassed.** Calorie and macro targets are produced only by `applyRails`. Every path that creates, edits or imports a target goes through it. Allergens are enforced at three gates (library filter, session builder, pre-solve `assertSafeForProfile`). Do not remove a gate because it looks redundant.
4. **No personal data reaches the solver.** A solver request has tasks with resolved durations, the kit, the concurrency cap and a time limit, and nothing else.
5. **Local-first.** No accounts, no sync. Profile, sessions, logs and weights live in on-device SQLite. Export and import must round-trip.
6. **Metrics are opt-in, anonymous and allowlisted.** Events must validate against `schemas/telemetry-event.schema.json`. No third-party analytics or advertising SDKs. Never log or send body, health, allergen, diet or recipe-choice data.
7. **Cook mode works offline.** Timers store absolute end timestamps, never decrementing counters. Session plans embed a render bundle. Creating a *new* plan needs a connection; nothing after that does.
8. **Everything user-visible is localizable** (English and Turkish). No hard-coded strings, amounts, temperatures or lengths (use the text placeholders). Use locale-aware casing and collation (Turkish dotted and dotless i).
9. **Schemas are the single source of truth.** Never hand-edit generated code. Derived recipe data (allergens, diet flags, capabilities, macros) is generated, never authored.
10. **Neutral tone.** No shaming or streaks or "over budget" language, and no celebration of extreme targets. See the tone guard in the planning spec.
11. **Optional equipment only helps.** Adding an appliance must never make a plan worse.

## Non-goals (do not build for the MVP)

Auto-generated meal plans, voice control, barcode or packaged-food support, a free-form food diary, user-submitted recipes, social features, grocery delivery, technique gating, per-operation speed learning, server-side re-solve during cooking, offline plan generation, accounts or cross-device sync, household measures (tea glass, spoons), languages beyond English and Turkish, third-party analytics. A change that adds one needs a PRD change first.

## Sensitive areas (human review required before merge)

Safety rails and their numbers, allergen and diet logic, hold limits and storage guidance, doneness statements, any Turkish text, the telemetry allowlist and consent copy, and anything touching health-gate or body data. Say so in the change description, and write the tests first for these.

## Tech defaults

Confirm current versions when scaffolding, and record deviations as ADRs in `docs/decisions/`.

- **Monorepo:** pnpm workspaces. TypeScript in strict mode, no `any`. ESLint and Prettier.
- **TypeScript tests:** Vitest, with fast-check for property tests.
- **Mobile:** Expo with a development build, `expo-sqlite`, `expo-notifications`, `expo-keep-awake`, `expo-localization`, an ICU-capable i18n library.
- **Solver:** Python 3.12+, `uv` or equivalent, FastAPI, OR-Tools CP-SAT, pytest with Hypothesis, ruff and a type checker.
- **Codegen:** JSON Schema to TypeScript and Pydantic (for example `json-schema-to-typescript` and `datamodel-code-generator`), deterministic, with a CI up-to-date check.
- **Data files:** YAML, validated by `tools/validate-data`.

## Commands

Filled in during M0. Keep this list accurate.

```
pnpm install
pnpm lint && pnpm typecheck
pnpm test                      # TypeScript unit and property tests
pnpm schemas:gen               # regenerate types from schemas (CI fails if stale)
pnpm data:validate             # validate everything in data/
pnpm conformance               # verifier conformance suite (TypeScript side)
pnpm bench                     # scheduler benchmarks and the plan viewer
cd services/solver && uv run pytest    # solver, Python verifier, Python conformance
```

## Conventions

- **Pure core.** `packages/core` functions are pure: no I/O, and time and randomness are parameters. Return data (for example verifier violations) instead of throwing for expected outcomes.
- **Units.** Grams, milliliters, Celsius in storage and computation. Imperial is display-only. Authoring durations are minutes, plans are **integer seconds**.
- **IDs.** ASCII snake_case slugs, stable, never renamed.
- **Tests.** Table-driven for formulas and rules, property-based for the scheduler and safety invariants, golden fixtures from `docs/examples/`. **No snapshot tests of solver plans** (solves aren't reproducible): assert properties and bounds. Every bug fix adds a regression test.
- **Conformance.** A change to any verifier rule needs conformance cases, and both the TypeScript and Python implementations must pass in CI. The two verifiers share **no code**.
- **Comments** explain why, not what. Cite the spec section for non-obvious rules.
- **Docs move with code.** Change behavior, update the spec in the same change. Mark tuning values as hypotheses and keep them in one config.
- **Privacy in logs.** Never log Problem contents, profile data, or anything on the telemetry "never collected" list.

## Working agreement

- Work one milestone at a time, in small reviewable changes, with tests included.
- If a spec is ambiguous, incomplete or contradicts another, **stop and ask** rather than guessing. The answer goes into the relevant document, plus an ADR if it is a decision.
- **Do not invent** recipes, nutrition values, allergen data, storage periods or safety numbers. Use `docs/examples/` only as fixtures: their nutrition values are illustrative and their source is `example_placeholder`, which CI rejects under `data/`.
- Definition of done: code, tests, docs, CI green, no new TODO without an issue.
- When a milestone finishes, update the "Current milestone" line and the commands section above.
