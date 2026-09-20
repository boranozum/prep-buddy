# Prep Buddy: Product Requirements Document

Status: DRAFT v0.1 (for review). Lives at `docs/PRD.md`.
Companion docs: `docs/data-model.md`, `docs/scheduler-spec.md`, `docs/planning-spec.md`, `docs/cook-mode-spec.md`, `docs/recipe-authoring-guide.md` (with `docs/examples/`), `docs/implementation-plan.md`, `docs/design/` (created by the design track), and `CLAUDE.md` at the repo root.

---

## 1. Problem and vision

Batch meal prep is one of the most effective ways to eat healthy and hit calorie and macro targets. But a session for one person typically takes **3-4 hours**, and it is tiring: many things happen at once, the oven and burners are contended, and it is easy to lose track of what is next.

Existing recipe apps give you recipes one at a time. Nobody gives you a **plan for cooking several recipes in one session**.

**Vision:** Prep Buddy is a cooking coach, like a gym buddy for the kitchen. The user picks recipes, and the app generates one optimized session (which tasks to batch, what to start first, what to do while something roasts) and walks them through it step by step, with timers, until everything is cooked, portioned and stored.

## 2. Target user

- Health-focused people who want to prep several days of meals in one session, to track calories and macros, or to lose weight through a calorie deficit.
- Beginners through experienced home cooks. Experience level changes plan speed and coaching depth, not eligibility.
- Global audience. The MVP launches in **English and Turkish**.
- Adults only. The app must not produce calorie or weight-loss plans for minors.

## 3. Core principles

These constrain every later design decision. If a proposed feature conflicts with one, the principle wins unless this document is amended.

1. **Scheduling is the differentiator.** Recipes are modeled as task graphs so a session plan can be computed. Cook mode and the scheduler get the most engineering attention.
2. **Deterministic scheduling, independently verified.** The plan comes from an algorithm, never from an LLM. A separate verifier checks every plan against all constraints before it reaches the user, whether it came from the solver or a fallback.
3. **Nutrition data is ours and never guessed.** Macros come from a curated canonical ingredient table seeded from USDA snapshots. An LLM never produces nutrition numbers.
4. **Optional equipment can only help.** Every task has a baseline method using basic equipment. Extra appliances add faster or easier methods. Owning more equipment must never make a plan worse.
5. **Safety rails are hard limits.** Calorie floors, deficit-rate caps and allergen exclusion are enforced in code, not just disclaimers. Ambiguous allergen data means exclude.
6. **Human-reviewed content.** Every recipe passes schema validation and human review before entering the library. LLMs may draft, but never publish.
7. **Cook mode works offline.** The session plan is cached before cooking starts. A bad kitchen connection must never block the next step. Creating a *new* plan needs a connection (the best plans come from the server solver); cooking, the shopping list and logging do not.
8. **Localizable from day one.** No user-visible string, ingredient name or unit label is hard-coded.

## 4. MVP scope

### In

| Area | Scope |
|---|---|
| Onboarding | Target mode (computed with safety rails, manual, or none), body stats and goal when computed, allergies and diet rules, equipment, experience level (beginner / comfortable / experienced), language and units |
| Recipe library | 20-30 hand-structured recipes in the task-graph format, including a stovetop-only subset (an oven is not required) |
| Session builder | User picks recipes and portions; live macro fit vs. daily targets; estimated session time before committing |
| Scheduling | Batching, CP-SAT solve in a Python service, on-device verifier, greedy fallback |
| Shopping list | Aggregated by canonical ingredient, pantry subtraction, staples tracked separately, metric or imperial |
| Cook mode | Mise en place, "now / while you wait" tracks, multiple timers with local notifications, "I'm behind" button (local repair), wrap-up with portioning, labeling and storage guidance |
| Tracking | Plan-as-log ("ate this" on a prepped container) plus a quick "other" entry (calories, optional macros). Macro display is hidden in no-targets mode |
| Learning | Record planned vs. actual times from day one; suggest a speed adjustment after consistent deviation over several sessions, and only with user confirmation |
| Localization | English and Turkish UI, recipes and ingredient names; metric and imperial units |
| Data | Local-first storage on the device; export and import of all user data as one versioned file |
| Metrics | Opt-in, anonymous, allowlisted session metrics (off by default); manual export during the private beta |

### Out (later), with reasons

| Cut | Reason |
|---|---|
| Auto-generated meal plans | Needs a separate selection stage; "pick your own" already delivers the core value. The selection module is kept separable so it can slot in later. |
| Voice control | Large tap targets plus screen wake lock are enough to start. |
| Barcodes and packaged foods | MVP is whole-ingredient cooking; avoids a second data source with variable quality. |
| Full food diary | Would become a second product. Plan-as-log plus "other" covers the honest gap. |
| User-submitted recipes | Recipes must be structured and reviewed; open submission breaks the quality bar. |
| Social features, grocery delivery | Not needed to validate the core claim. |
| Technique gating, per-operation speed learning | Needs skill tags on tasks and more session data. |
| Server-side re-solve during cooking | MVP uses on-device local repair (shift remaining tasks, then verify), which removes a network dependency from cook mode. Revisit with real session data. |
| Languages beyond English and Turkish | Add after the localization pipeline is proven. |
| Household measures (tea glass, water glass, spoons) as display units | Needs a per-ingredient density table; metric and imperial cover the MVP. |
| Offline plan generation | The best plans come from the server solver. Offline, existing plans still work, and new plans need a connection. On a solver outage the on-device greedy scheduler is a labeled fallback. |
| Accounts and cross-device sync | Body stats are sensitive; local-first avoids a user backend while the core is validated. Export and import covers device loss. |

## 5. Localization and units

- **Languages at launch:** English (`en`) and Turkish (`tr`).
- **Everything user-facing is localizable:** UI strings, recipe titles and instructions, ingredient names and aliases, task coaching text, allergen and safety copy.
- **Ingredients have language-neutral IDs** with localized names and aliases (for example "eggplant" / "aubergine" / "patlıcan"). Turkish names and aliases are authored in the canonical table, since the USDA source is English-only.
- **Human translation for safety-critical text.** Allergen warnings, food-safety guidance and calorie-floor messaging must be reviewed by a fluent speaker, not machine-translated unreviewed.
- **Turkish-specific engineering notes:**
  - Case handling must be locale-aware (dotted and dotless i: `İ`/`i` and `I`/`ı`). Never rely on naive `toLowerCase()` for search or matching.
  - Sorting and search must use locale-aware collation.
  - Ingredient search must match both `tr` and `en` names and aliases regardless of UI language.
- **Units:** canonical storage is grams and milliliters. Display is metric or imperial per user preference. Household measures (tea glass, water glass, spoons) are out of the MVP: they need a per-ingredient density table and can be added later as a display option.
- **Number and date formatting** follows the device locale.

## 6. Key user flows

1. **Onboarding.** Language and units, body stats and goal (safety rails applied), allergies and diet, equipment (burners, oven yes/no and tray count, optional appliances), experience level. Output: a profile, calorie and macro targets (unless the user chose no-targets mode), and a filtered recipe library.
2. **Build a session.** Browse the filtered library, add recipes and portion counts, see live macro fit and estimated session time. Shortfalls are stated plainly ("protein is 25 g/day short with these picks").
3. **Shop.** Generate the shopping list, subtract pantry items, view by store section, check items off.
4. **Cook.** Mise en place, then step-by-step execution with parallel tracks, timers and local notifications, and the "I'm behind" button for on-device re-planning.
5. **Wrap up and log.** Portion into containers with labels, get fridge/freezer guidance, log meals over the following days with one tap, add "other" entries as needed. The session's planned vs. actual times are recorded, and the app may suggest a speed adjustment.

## 7. Success metrics

**Primary**
- Planned vs. actual session time (accuracy of the plan).
- Session completion rate (users who start cook mode and finish the wrap-up).

**Secondary**
- Session length compared with the user's self-reported baseline. The launch hypothesis is 3-4 hours down to about 2 hours, to be validated per experience level.
- Repeat sessions within 2 weeks.
- "I'm behind" usage rate. A high rate signals plans are too aggressive.
- Share of logged meals that come from plan-as-log vs. "other".

**Guardrails (must be zero)**
- Plans that violate a user's declared allergens or diet.
- Plans that fail the verifier but reach a user.
- Calorie targets below the safety floor.

**Measurement.** The app is local-first, so metrics come from an **opt-in, anonymous** pipeline, off by default, plus manual data-file export during the private beta.
- **Collected (allowlist only):** app version, platform, UI locale, experience level, kit class (burner count, oven yes/no, number of accelerator appliances), counts (recipes, task instances, repairs, "I'm behind" presses, hold-limit events), planned vs. actual elapsed time, hands-on time, mise time, plan producer (solver or greedy) and solver status and time, verifier result, completion status, pace feedback, and the optional self-reported baseline session length (bucketed).
- **Never collected:** body, weight, target, health-gate, allergen or diet data; recipe or ingredient choices; free text; precise timestamps (week-level only); location; device or advertising identifiers.
- **Identity:** a random install ID generated on the device, unrelated to any device identifier, resettable by the user. It exists only to count repeat sessions.
- **Consent:** asked once after onboarding, plain language in both locales, default off, revocable in settings. Revoking stops collection and offers deletion of data held under the install ID. Consent text version and time are stored locally.
- **Mechanics:** events are validated against `schemas/telemetry-event.schema.json` on the client (invalid events are dropped) and again on the server (unknown fields are rejected). They are batched and uploaded after a session when online. The ingestion service is separate from the solver, does not store IP addresses, and has a documented retention period (to be set with legal review).
- No third-party analytics or advertising SDKs.

Numeric targets for the primary and secondary metrics are to be set once a first cohort exists.

## 8. Risks and open questions

**Risks**
- **Recipe authoring cost.** 12-20 structured tasks per recipe, with review, is slow. Mitigation: LLM-drafted, schema-validated, human-reviewed; small MVP library.
- **Timer reliability.** Alerts must fire with the phone locked. Mitigation: absolute end timestamps and scheduled local notifications.
- **Self-reported experience is unreliable.** Mitigation: three conservative levels, recorded actuals, user-confirmed adjustments.
- **The core claim is unvalidated.** "3-4 hours down to about 2" is a hypothesis. Validate early with a small number of real sessions before investing in breadth.
- **Nutrition data coverage.** USDA underserves some regional ingredients. Mitigation: curated table with source IDs; extend with regional databases later.
- **Verifier drift.** TypeScript and Python verifiers could disagree. Mitigation: shared conformance suite in CI.
- **Solver dependency at planning time.** New plans need a connection and a running service. Mitigation: stateless service that is easy to scale, greedy fallback on failure, cached plans for everything after planning.
- **Metrics depend on opt-in rates.** Expect a minority of users to opt in. Mitigation: a clear and honest consent screen, plus manual export from beta testers, and treating the metrics as directional.
- **Data loss with local-first storage.** A lost or replaced phone loses history. Mitigation: export and import in the MVP; sync later.

**Open questions**
- Monetization model (free, subscription, one-time). Not needed for MVP scope but affects store setup.
- Which regions to seed the recipe library for, given English and Turkish at launch.

## 9. Non-goals

Claude Code must **not** build any of the following during the MVP: auto-generated meal plans, voice control, barcode scanning, a free-form food diary, user-submitted recipes, social features, grocery delivery integration, technique gating, per-operation speed learning, server-side re-solve during cooking, third-party analytics or advertising SDKs, user accounts or cross-device sync, offline plan generation, or languages beyond English and Turkish.

## 10. Decision log

| # | Decision | Choice |
|---|---|---|
| 1 | Nutrition data | Curated canonical ingredient table seeded from USDA (Foundation + SR Legacy) snapshots; whole ingredients only |
| 2 | Recipe model | Task graphs with active/passive time, capability-based resources, batch keys, hold limits; methods with baseline plus accelerators; oven not required |
| 3 | Scheduler | Hybrid pipeline: batch, CP-SAT solve, independent verify, greedy fallback; experience level sets active-time multiplier, concurrency cap, slack, coaching depth; user-confirmed speed adjustments |
| 4 | Platform | React Native (Expo), TypeScript; verifier and greedy fallback on device; solver in a Python service; voice deferred |
| 5 | Planning layer | User picks recipes; app handles portions, shopping list and schedule; selection module kept separable |
| 6 | MVP scope and tracking | As in section 4; plan-as-log plus "other" entry |
| 7 | Repo layout | Monorepo: `apps/mobile`, `services/solver`, `packages/core`, `data/`, `schemas/`, `docs/`, plus `tools/` for CLI tools (data validator, plan viewer, benchmarks) |
| 8 | Languages and units | English and Turkish at launch; metric and imperial; household measures deferred |
| 9 | Data storage | Local-first on device (SQLite); no accounts or sync in the MVP; export and import of user data; stateless solver service |
| 10 | Connectivity | Creating a new plan requires a connection to the solver service; cook mode, shopping list and logging work offline; greedy fallback only on service failure |
| 11 | No-targets mode | Available to adults by choice and in the health-gate case (with manual targets as the other option); under-18 stays blocked |
| 12 | Metrics | Opt-in anonymous allowlisted metrics (off by default), random resettable install ID, separate ingestion service, manual export during beta |
| 13 | Build order | Riskiest-first: schemas, recipe validation and the scheduler (with a plan viewer) are built and gated before any mobile UI |
| 14 | Design track | Design runs in parallel (D0-D3): cook mode is designed and kitchen-tested first, the design system is complete before the app is built (M5), and UI code uses shared tokens and components |
