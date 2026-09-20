# Prep Buddy

Prep Buddy is a mobile app that acts as a cooking coach for **batch meal prep**. The user picks several recipes, and the app computes **one optimized cooking session** (what to batch, what to start first, what to do while something roasts) and walks them through it step by step, with timers, until everything is cooked, portioned and stored. It also handles calorie and macro targets, allergies, a shopping list and simple tracking.

Status: early implementation. Current milestone is **M1** (see `docs/implementation-plan.md`).

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

`data/` is scaffolded but still empty — reviewed content is authored in M8. `apps/mobile/` is scaffolded starting M5.

## Start here

1. `CLAUDE.md` — working agreement, non-negotiable rules, conventions for anyone (human or Claude Code) working in this repo.
2. `docs/PRD.md` — problem, scope, principles, non-goals, decisions.
3. `docs/implementation-plan.md` — milestones, acceptance tests, gates.
4. `docs/README.md` — full reading order and status of the spec documents.

## License

Unlicensed / private project.
