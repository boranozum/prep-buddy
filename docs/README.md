# Prep Buddy documentation

This package is the complete product and engineering specification for Prep Buddy, written to be read by Claude Code and by humans. Unzip it at the **root of the monorepo** (it contains `CLAUDE.md` and `docs/`).

## Reading order

| # | File | What it is |
|---|---|---|
| 1 | `../CLAUDE.md` | Rules, layout and conventions Claude Code reads every session |
| 2 | `PRD.md` | Problem, scope, principles, non-goals, metrics, decision log |
| 3 | `implementation-plan.md` | Milestones M0-M9, acceptance tests, decision gates (riskiest first) |
| 4 | `data-model.md` | Schemas and entities (v0.2, consolidated) |
| 5 | `scheduler-spec.md` | Expansion, batching, CP-SAT model, verifier, greedy, repair, speed estimator |
| 6 | `planning-spec.md` | Targets, safety rails, filtering, scaling, shopping list, tracking |
| 7 | `cook-mode-spec.md` | State machine, timers and notifications, one-tap timing capture, wrap-up |
| 8 | `recipe-authoring-guide.md` | How recipes are authored and reviewed |
| 9 | `examples/` | 3 worked recipes, 15 ingredients, prototype validator (`python3 validate_examples.py`, needs `pip install pyyaml`) |

`decisions/` (ADRs) and `reports/` (gate reports, sign-offs) start empty.

## Starting Claude Code

From the repo root, a good first prompt is:

> Read `CLAUDE.md`, `docs/PRD.md` and `docs/implementation-plan.md`. Then implement milestone M0 following the plan, reading `docs/data-model.md` for the schema work. Stop and ask if anything in the specs is ambiguous or contradictory.

Continue one milestone at a time. Gate G1 (the scheduler claim check, end of M3) is a real decision point, so review it before building the app.

## Status and things that need humans

- All documents are **DRAFT v0.1** (data model v0.2) and need your review.
- **All nutrition values in `examples/` are illustrative** (source `example_placeholder`). Real values must come from a reviewed USDA snapshot.
- **Every numeric safety value is a hypothesis** for expert review: calorie floors and macro defaults (dietitian), hold limits, cooling and storage periods, doneness temperatures (food-safety reviewer).
- **Turkish text was drafted, not reviewed.** Every Turkish string needs a fluent reviewer.
- A legal and privacy review is needed for body, health-gate and weight data and the opt-in metrics pipeline.
