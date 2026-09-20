# Prep Buddy: Implementation Plan

Status: DRAFT v0.1 (for review). Lives at `docs/implementation-plan.md`.
Read with: `CLAUDE.md` (repo root), `docs/PRD.md`, and the four specs and the authoring guide it references.

---

## 1. Approach: riskiest first

The product's whole promise is that a computed plan makes a 3-4 hour batch cook feel like about 2 hours and easy. Everything else (onboarding, tracking, polish) is conventional engineering. So we **prove the scheduler first, with no UI**, and build the app around a plan we know works.

- Milestones M0-M3 produce the schemas, the recipe pipeline, the scheduler and the solver, ending in a written **decision gate (G1)** on the core claim.
- M4-M7 build the planning layer and the app on top of a proven engine.
- Three parallel tracks run alongside: **design**, **content** (ingredients and recipes) and **compliance** (dietitian, food safety, language, legal and privacy reviews). They have long lead times and start early.

Sizes below are relative (S, M, L), not calendar estimates, because they depend on team size.

## 2. Overview

| # | Milestone | Size | Ends with |
|---|---|---|---|
| M0 | Foundations | S | Monorepo, CI, deterministic codegen |
| M1 | Data pipeline | M | Recipe files validated, derived data generated |
| M2 | Scheduler core (TypeScript) | L | Greedy plans, verifier, conformance suite, plan viewer, benchmarks |
| M3 | Solver service (Python) | L | CP-SAT plans, **Gate G1: claim check** |
| M4 | Planning layer | M | Targets, safety rails, filtering, scaling, shopping list |
| M5 | Mobile foundation | L | Onboarding, library, session builder, shopping list, persistence |
| M6 | Cook mode | L | State machine, timers, repair, **Gate G2: real-device timers** |
| M7 | Wrap-up, tracking, metrics | M | Containers, log, estimator, opt-in metrics, export/import |
| M8 | Content and compliance track | L, parallel | Library published, sign-offs recorded |
| M9 | Beta and launch | M | Private beta results, **Gate G3: launch readiness** |
| D0-D3 | Design track | M, parallel | Design system before M5, cook mode kitchen-tested (D1) |

```
M0 -> M1 -> M2 -> M3 --G1--> M4 -> M5 -> M6 --G2--> M7 -> M9 --G3--> launch
        \                     ^
         \--> M8 (content and compliance, parallel, needed by M4 tests and M9)
 D0 -> D1 (during M3) -> D2 (before M5) -> D3 (during M5-M7)   design track, parallel
```

## 3. Ground rules for every milestone

- **Definition of done** for a task: code, tests, docs updated in the same change, CI green, and no new `TODO` without an issue.
- **Sensitive areas** need explicit human review before merge (see `CLAUDE.md`): safety rails, allergen logic, hold limits and storage guidance, Turkish text, telemetry allowlist and consent copy.
- **Decisions and deviations** are recorded as short ADRs in `docs/decisions/NNN-title.md`. If a spec is ambiguous or contradicts another, stop and ask instead of guessing.
- **No invented data.** Recipes, nutrition values and food-safety numbers come from reviewed sources, never from a model's memory.
- Each milestone lists **acceptance tests**. A milestone is complete only when every one passes and is checked into CI (or, for manual ones, the result is recorded in `docs/reports/`).

## 4. M0: Foundations (S)

**Tasks**
1. Monorepo scaffolding per `CLAUDE.md`: `apps/mobile`, `services/solver`, `packages/core`, `data/`, `schemas/`, `docs/`, plus `tools/` for CLI tools (validator, plan viewer, benchmarks).
2. Tooling: TypeScript strict, linting and formatting, test runners (TypeScript and Python), pre-commit checks.
3. CI pipeline: lint, type check, unit tests, schema codegen check, data validation, conformance suite (skipped until M2).
4. Schema pipeline: JSON Schema in `schemas/` to generated TypeScript types and Pydantic models, with a CI check that generated code is up to date. Write the first schemas from `docs/data-model.md` v0.2.
5. Move the documents into `docs/`, and `docs/examples/` alongside them. Create `docs/decisions/` with `001-tech-defaults.md` recording the tooling choices.

**Acceptance tests**
- CI passes on an empty feature branch.
- Changing a schema without regenerating code fails CI.
- Generated TypeScript and Pydantic types agree on a shared sample document (round trip through both).
- The prototype validator in `docs/examples/` still passes.

## 5. M1: Data pipeline (M)

**Tasks**
1. Finalize all data schemas (ingredient, recipe, task, method, capabilities, diet rules, locales) from `docs/data-model.md`.
2. Implement the **build validator** (`tools/validate-data`), porting `docs/examples/validate_examples.py` and covering every rule in `docs/data-model.md` section 4 and the authoring guide.
3. Implement the **derived-data generator**: recipe allergens, diet flags, required capabilities, macros per serving, prep estimate, written to `data/generated/`.
4. Implement locale-aware text utilities (Turkish casing, collation) in `packages/core`, with cross-language ingredient search.
5. Move the example recipes and ingredients into a staging area (`data/` is for real, reviewed data only). Keep `example_placeholder` rejected there.

**Acceptance tests**
- All three example recipes validate. The derived output equals the fixtures in `docs/recipe-authoring-guide.md` section 17 (per-serving macros, task counts, hands-on and passive minutes, critical path, capabilities, diet flags).
- **Mutation tests:** every negative case from the prototype (empty locale, raw amount in text, dependency cycle, accelerator as baseline, batch-key op mismatch, bad hold action, implausible kcal, placeholder mismatch) fails validation, plus new cases for each rule added since (missing `hold_kind`, orphan ingredient, unproduced intermediate, `published` without reviewers, `example_placeholder` in `data/`).
- Turkish search test: `IRMIK` matches `ırmık`, and an English query finds a Turkish-named ingredient by alias.
- Removing a locale from any content string fails CI.

## 6. M2: Scheduler core, TypeScript (L)

Implements `docs/scheduler-spec.md` sections 3, 4, 5.1, 7 and 8 in `packages/core`.

**Tasks**
1. **SchedulingProblem** schema and generated types.
2. **Expansion:** quantities, duration formulas, the experience multiplier (active time only), slack on `safety` and `quality` holds only, equipment filtering, `max_batch_g` filtering, oven and pot resources.
3. **Batching:** merge rules, merged durations, capacity, and the undo interface (split a named group).
4. **Greedy scheduler:** method choice, priority rules, just-in-time release for hold-limited tasks, oven model (temperature compatibility, trays, preheat), concurrency cap. Deterministic.
5. **Verifier:** all rules V001-V015, structured output.
6. **Conformance suite** in `schemas/conformance/`: at least one valid and one invalid case per rule, boundary cases (a hold limit met to the second, capacity exactly reached), plus randomly generated cases checked against a brute-force reference checker.
7. **Plan viewer** (`tools/plan-viewer`): a static HTML page from a Plan and Problem JSON showing a timeline (hands, burners, oven, each item's active and passive phase, holds) and summary numbers: makespan, hands-on time, idle time, the hands-on **lower bound**, and the **sequential baseline** (each recipe scheduled alone, summed).
8. **Benchmark harness** (`tools/benchmarks`): three recipe sets (2, 4, 6 recipes) crossed with three kits (minimal stovetop, standard, fully equipped) and three experience levels. Seed it with the three example recipes and add recipes as M8 delivers them.

**Acceptance tests**
- Every greedy plan for every benchmark passes the verifier.
- **Determinism:** 100 runs of greedy on the same Problem are byte-identical.
- Conformance suite passes with the required coverage.
- Property tests (P1 verifier gate, P5 determinism, P6 batching never increases active time, P7 multiplier monotonicity and passive invariance), using a property-testing library.
- Expansion tests: slack never tightens `continuity` holds, capacity filtering removes an over-capacity method, the multiplier changes only active time.
- The plan viewer renders the three-recipe plan, and the numbers on screen match the harness output.

## 7. M3: Solver service, Python (L)

Implements `docs/scheduler-spec.md` sections 5.2-5.7, 6 and 12.

**Tasks**
1. **CP-SAT model:** optional intervals for methods, no-overlap on hands, cumulative burners and pools, oven bands, trays and preheat, precedence, hold lags, concurrency cap, lexicographic objective (makespan, hands-on time, switches), greedy plan as warm start.
2. **Python verifier** (independent of the solver) passing the shared conformance suite.
3. **FastAPI service** `POST /v1/solve`: stateless, time-limited, validates requests, verifies its own output, structured infeasibility hints, no logging of Problem contents.
4. **Client orchestration** in `packages/core`, `planSession()`: expand, batch, call the solver, verify on the client, unmerge and retry (up to 3 rounds), fall back to greedy on service failure, and refuse to proceed when offline.
5. **Golden cases:** three small hand-solved instances with known optimal makespans.
6. **Deployment ADR** (`docs/decisions/`): where the service runs, scaling and time limits, and abuse protection without accounts (rate limits, client attestation). Decide before M9, and record the choice.

**Acceptance tests**
- Golden cases hit their known optimum.
- Each constraint has a tiny instance that fails when the constraint is removed from the model (guards against silently dropped constraints).
- P1 (verifier gate on solver output, both verifiers), P3 (adding equipment never worsens the optimal plan, on small instances), P4 (solver never worse than greedy), P6, P7.
- Performance: 100 task instances solved within 10 s on CI hardware, with the numbers recorded.
- `planSession` tests with a fake solver: a plan that fails the client verifier is never returned, timeouts fall back to greedy with a label, offline returns a clear error, and the unmerge loop terminates.
- The conformance suite passes in both languages in CI.

### Gate G1: the claim check

**Procedure.** On the benchmark harness, run:
- **Set S3:** `chicken_pilaf`, `red_lentil_soup`, `sheet_pan_chicken_veg` with the standard kit (4 burners, one oven with 2 trays, two pots, two pans, no accelerators), at the comfortable level (multiplier 1.0).
- The same set with each accelerator added one at a time (rice cooker, pressure cooker, blender, air fryer).
- **Set S2:** the pilaf and soup only, with a minimal kit (2 burners, one pot, one pan, no oven).
- The three set/kit combinations at all three experience levels.

**Report** (in `docs/reports/g1-claim-check.md`): makespan, hands-on time, idle time, lower bound, sequential baseline, and the ratio of each to the makespan, plus solver time.

**Reference points** (illustrative data, reference cook): sequential cooking is about 241 minutes, the hands-on lower bound is about 106.5 minutes, so the target is a makespan of roughly **125 minutes or less** for S3 with the standard kit. For a beginner (multiplier 1.5) the lower bound is about 160 minutes, so **the "about 2 hours" claim cannot hold for beginners with this recipe set**, and the PRD already says the claim must be evaluated per experience level.

**Outcome.** G1 is a decision, not an automatic pass or fail. Record an ADR choosing one of:
1. **Proceed**, the claim holds at the target level.
2. **Proceed with a revised claim** (for example per-level ranges, or "about 40% shorter").
3. **Investigate** before building more: the model may be too constrained (pot limits, concurrency cap, oven sharing), recipes may be unrealistic, or durations may need measurement. Fix, then rerun the gate.

Real measured durations from the cook-twice protocol (M8) should replace the illustrative ones before the gate result is treated as final for launch messaging.

## 8. M4: Planning layer (M)

Implements `docs/planning-spec.md` in `packages/core`, pure and tested, with no UI.

**Tasks**
1. Targets: BMR, TDEE, goal to energy, macro split, meal slots.
2. **`applyRails`** with all rules R1-R10 (including manual and no-targets modes), the only producer of targets.
3. Library filtering: allergens, diet rules, equipment, dislikes, and the three allergen gates including `assertSafeForProfile`.
4. Portion scaling: bounded least-squares fit, rounding with recomputed macros, raw vs. cooked handling.
5. Session builder logic: live macro fit, shortfall messages as keyed parameters, slot coverage, auto-scale, prep-time preview via greedy.
6. Shopping list: aggregation, edible fraction, pantry, staples, pack sizes, units.
7. Tracking math: containers, log entries, daily and weekly totals with "at least" handling.
8. Weight trend and target suggestion logic.

**Acceptance tests**
- T1 (rails, table-driven and property-based), T2 (allergen gates, generative), T3 (derived tags), T4 (formula golden tests), T5 (scaling bounds), T6 (macro conservation), T7 (shopping list), T8 (import re-validation), T9 (units), T10 (Turkish search).
- Rails: independent reviewer confirms the test table covers every rule and boundary.
- **Dietitian review of all numeric values is scheduled** (compliance track) before M5 ships any user-facing target screen.

## 9. M5: Mobile foundation (L)

**Prerequisite:** design stage D2 is complete (`docs/design/` tokens, components and screens).

**Tasks**
1. Expo app shell, navigation, theming (light and dark) built from `docs/design/tokens.json`, and shared components with the tone guard baked in.
2. i18n with `en` and `tr` UI strings, pseudo-locale for testing, locale-aware formatting.
3. Persistence: SQLite with migrations for profile, sessions, records, logs, containers, weights, pantry. Versioned **export and import** of all user data, with `applyRails` re-run on import.
4. Onboarding: language and units, target mode (computed, manual, none) with the health gate and adult check, body stats, goal, allergies and diet, equipment, experience level, optional baseline session length.
5. Library and session builder: filtered library, servings and portions, live macro fit, prep-time preview, and plan creation via `planSession` (labels for greedy fallback, a clear message when offline).
6. Plan review screen and the shopping list, working offline.
7. Consent screen for opt-in metrics (the pipeline itself is M7).

**Acceptance tests**
- Onboarding paths for computed, manual and none modes, and the R1 and R6 blocks, are covered by UI tests. In `none` mode no calorie or macro string renders (T12).
- Export then import into a fresh install reproduces the data, and an unsafe imported target is corrected or rejected.
- Airplane mode: the library, session builder preview, shopping list and stored plans work. Building a new plan shows the offline message.
- Every UI string exists in both locales, the pseudo-locale layout test passes, and text scaling to 200% doesn't hide primary actions.
- Screen reader labels present on all controls.
- Tone-guard lint (T11) passes.

## 10. M6: Cook mode (L)

Implements `docs/cook-mode-spec.md` and the repair algorithm in `packages/core`.

**Tasks**
1. **Repair** in core: freeze, shift-only, greedy re-schedule with pinned intervals, the safe fallback with authored actions and drop-recipe, always verified.
2. Cook session state machine with persistence on every transition, and a reconcile function.
3. **Timer engine** with absolute timestamps, notification scheduling (end and hold-warning notifications at passive start), extension handling, permission and denial handling, the first-session test alarm.
4. Screens: mise en place, cooking (primary card, while-you-wait lane, waiting card, skip ahead, timeline), the "I'm behind" flow, pause, welcome-back summary, hold-exceeded surfaces.
5. One-tap timing capture, undo, suspicious-tap detection, `sole_focus` derivation, all events into the SessionRecord.
6. Wake lock and low-battery behavior. Landscape and portrait.

**Acceptance tests**
- P8 (repair returns a verified plan or an explicit fallback, never an unverified one), plus determinism and a repair performance budget check.
- State machine: process kill at every transition resumes identically.
- Fake-clock timer tests (firing order, long background, late timers, clock jumps, simultaneous timers).
- Notification scheduling tests with a mocked API.
- **Gate G2, real-device protocol** (recorded in `docs/reports/g2-devices.md`): lock-phone timers of 30 and 90 minutes on at least 2 iOS and 3 Android devices (including two Android vendors), with silent mode, Do Not Disturb or Focus, low power mode, and after a reboot. Any device where a timer fails to alert is documented with the mitigation (or the milestone doesn't pass).
- **Dogfooding:** the team cooks at least 3 complete real sessions with the app. Planned vs. actual times are compared against the G1 numbers, and problems are filed.
- The findings of the **D1 kitchen test** (design track) are reviewed, and each is resolved or explicitly deferred.

## 11. M7: Wrap-up, tracking and metrics (M)

**Tasks**
1. Wrap-up: weigh-the-batch, containers and labels, storage and cooling guidance, the summary with pace feedback.
2. Tracking: plan entries, "other" entries, fractions, daily and weekly views, containers inventory, weight entries and trend suggestions (opt-in).
3. **Speed estimator** and the suggestion flow (scheduler spec section 10.2), with all thresholds in one config.
4. **Opt-in metrics:** the telemetry allowlist schema, client validation and batching, the consent lifecycle (grant, revoke, delete request), the separate ingestion service (no IP storage, retention configured), server-side validation rejecting unknown fields.
5. No-targets mode polish throughout.

**Acceptance tests**
- Estimator tests (qualifying items, asymmetric thresholds, step caps, suppression after decline, exclusion of suspicious items).
- Telemetry: an event with any non-allowlisted field is rejected on both client and server, nothing is sent without consent, revoking stops uploads, and a payload snapshot test proves no body, health, allergen, diet or recipe data is included.
- Macro conservation (T6) end to end from containers to daily totals.
- Privacy review checklist completed (compliance track).

## 12. M8: Content and compliance track (parallel)

**Content**
1. **Ingredient seeding:** a script that pulls reviewed USDA Foundation and SR Legacy records into `data/ingredients/`, and a review workflow for each (nutrition, yields, allergens, diet flags, densities, unit weights, pack sizes, Turkish names and aliases). Target: about 100-150 ingredients.
2. **Recipe authoring** (`docs/recipe-authoring-guide.md`): 20-30 recipes including a stovetop-only subset and enough variety for the "shared bases" idea, each cooked twice with stopwatch timing. Track author, technical, food-safety and per-locale reviewers in the recipe files.
3. A timing-log template for the cook-twice protocol.
4. Replace the illustrative durations used in the benchmarks with measured ones as recipes are published.

**Compliance** (start early, long lead times)
- **Dietitian review** of every number in planning spec sections 2 and 3, **before M5 ships target screens**.
- **Food-safety review** of hold limits, cooling, storage periods and doneness statements, per recipe and in the authoring guide.
- **Language review** of all English and Turkish content and UI by fluent reviewers, including safety text and the tone-guard copy.
- **Legal and privacy review:** body, health-gate and weight data are sensitive personal data. Check requirements for the launch markets (for example GDPR in the EU and KVKK in Turkey), the consent flow, the metrics pipeline and retention, before **M7 ships** and again before launch.
- **Store and platform requirements:** notification and exact-alarm justifications, health-data disclosures, age rating.

**Acceptance:** the launch library is published with all reviewers recorded, and written sign-offs are stored in `docs/reports/`.

## 13. Design track (parallel)

The specs define behavior, not appearance or layout. Design runs alongside engineering so the riskiest screen is tested early and the design system exists before the app is built.

**Riskiest design first.** Cook mode has to work with wet hands, at arm's length, with several timers running and the "waiting" and "I'm behind" states. It can be prototyped long before code exists, and changes are cheapest now. Conventional screens (onboarding, library, shopping list) wait.

| Stage | When | Deliverables | Exit criteria |
|---|---|---|---|
| **D0** | Alongside M0-M2 | `docs/design/design-brief.md`: visual direction, tone, accessibility principles, spec constraints (below). Rough cook-mode wireframes for every state | Brief approved. Wireframes cover mise en place, the current-step card, the waiting card, the "while you wait" lane, the alarm surface, the "I'm behind" sheet, result and fallback screens, pause, welcome-back, hold-exceeded, and the weigh-the-batch step |
| **D1** | During M3, once the plan viewer exists | A clickable cook-mode prototype that runs on a phone, driven by a real plan from the viewer. **Kitchen test:** cook one real multi-recipe session following the prototype | Findings in `docs/reports/d1-kitchen-test.md`: missed taps, glanceability, confusing moments, timer and alarm behavior. Any change to `docs/cook-mode-spec.md` is proposed, approved and made explicitly |
| **D2** | Finished **before M5 starts** | Design system: color tokens with contrast ratios, type scale that survives 200% text scaling, spacing, core components, light and dark themes, Turkish long-string test screens, `docs/design/tokens.json`. Screens: onboarding, session builder, library, plan review, shopping list, consent, tone-guard copy samples | Design review checklist passed (accessibility, both locales, both orientations for cook mode) |
| **D3** | During M5-M7 | Wrap-up, containers, tracking and weight views, empty and error states, app icon and store assets | Reviewed against the same checklist |

**Constraints every design must respect** (from the specs):
- One primary action per screen. The **Done** button is full width, anchored at the bottom, at least 72 dp high, and never scrolls out of view.
- Bottom-anchored actions and undo instead of confirmation dialogs.
- Neutral tone: no red for lateness or exceeding a target, no streaks, no shaming, no celebration of extreme targets (planning spec, tone guard).
- Color is never the only cue. Recipe badges combine a letter and a shape.
- Layouts work at 200% OS text size, in portrait and landscape for cook mode, in English and in Turkish (strings up to 30-40% longer).
- Contrast at WCAG AA or better, checked in bright light, with a dark theme.
- Hidden calorie and macro figures in `none` mode, so every screen with nutrition data needs a variant without it.

**Where it lives.** `docs/design/` (brief, tokens, wireframes, prototypes). Prototypes can be interactive HTML pages, and a design tool is optional. `tokens.json` is the machine-readable source for the mobile theme, so code and design cannot drift.

**Rule for Claude Code.** UI code uses tokens and shared components from the design system. It does not invent colors, sizes, spacing or strings. If a needed design is missing, it asks.

## 14. M9: Beta and launch (M)

**Tasks**
1. Deploy the solver and ingestion services per the M3 ADR: monitoring, alerting, rate limits, and client attestation or the chosen abuse protection.
2. **Private beta** with manual data export from testers, plus opt-in metrics for those who agree. Track planned vs. actual time, completion, "I'm behind" rate, timer reliability reports and repeat sessions.
3. Performance, battery and reliability passes on low-end devices.
4. Store submission assets, privacy notices and consent text in both locales.

**Acceptance and Gate G3 (launch readiness):** all compliance sign-offs present, G1 and G2 outcomes recorded, beta results reviewed against the PRD metrics and guardrails (zero allergen violations, zero verifier failures reaching users, no target below the safety floor), and a written go or no-go.

## 15. Testing strategy at a glance

| Layer | What | Where |
|---|---|---|
| Unit and table-driven | Formulas, rails, filters, shopping list | `packages/core` |
| Property-based | Scheduler and safety properties (P1-P9, T1-T12) | `packages/core`, `services/solver` |
| Conformance | Verifier agreement across TypeScript and Python | `schemas/conformance/`, both languages in CI |
| Data validation | Every file in `data/` on every change | CI |
| Golden and benchmark | Hand-solved cases, benchmark harness, G1 report | `tools/`, `docs/reports/` |
| UI and integration | Onboarding paths, offline behavior, i18n and accessibility | `apps/mobile` |
| Real-device manual | Timer reliability protocol (G2), dogfooding | `docs/reports/` |

No snapshot tests of solver plans: solves aren't reproducible, so tests assert properties and bounds.

## 16. Risks specific to the plan

| Risk | Mitigation |
|---|---|
| Scheduler can't hit the claim | G1 catches it early, before any UI. Options: revise the claim, adjust the model or recipes |
| Illustrative durations mislead G1 | Measure real durations in M8 and rerun the benchmarks before launch messaging |
| Content and compliance lead times block M4-M9 | Start the track at M1, engage the dietitian and food-safety reviewers before M4 |
| Timer reliability differs by device | G2 real-device protocol, test alarm in the app, documented mitigations |
| Verifier drift between languages | Shared conformance suite in CI, no shared implementation |
| Solver hosting and abuse | ADR in M3, decided before M9 |
| Scope creep into non-goals | `CLAUDE.md` lists them explicitly, and PRs adding one need a PRD change first |
| Screens built before they are designed, or cook mode fails in a real kitchen | Design track: cook mode prototyped and kitchen-tested at D1, design system done before M5 |

## 17. Open decisions to resolve during the plan

- Solver hosting, scaling and abuse protection (ADR in M3).
- Visual direction, brand and design tooling (decided in D0).
- How recipe content ships: bundled with the app and updated over the air, or as versioned content packs (decide in M5; the render bundle makes running sessions safe either way).
- Metrics retention period and ingestion hosting (with legal review, before M7).
- Whether per-task timing ratios by recipe ID should ever be collected (needs explicit consent text).
- Kosher handling and any diet rule beyond the MVP list.
- Explicit vessel linking in the scheduler (post-MVP).
- Lock-screen timer display, voice control, label printing (post-MVP).

## 18. Working with Claude Code

- Run **one milestone at a time**. Start a session with: "Implement milestone Mx from `docs/implementation-plan.md`. Read `CLAUDE.md` and these documents first: ..." and list the specs the milestone references.
- Ask for **small, reviewable changes**: one task per change, tests included.
- For safety-critical modules (rails, allergen gates, verifier), have Claude Code write the **tests first** and have a human review the test table before the implementation.
- When Claude Code finds a spec gap, it should **stop and ask**, and the answer goes into the relevant document (and an ADR if it's a decision), so the docs stay the source of truth.
- After each milestone, update `CLAUDE.md`'s "current milestone" line and the commands section.
