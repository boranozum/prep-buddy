# Prep Buddy: Data Model and Schemas

Status: DRAFT v0.2 (for review). Lives at `docs/data-model.md`.
Depends on: `docs/PRD.md`. Consumed by: scheduler spec, planning layer spec, cook mode spec, recipe authoring guide.
v0.2 consolidates every schema addition requested by the later specs and the example recipes (`docs/examples/`). **Where any other document lists a schema follow-up, this file already contains it.**

---

## 1. Principles

1. **JSON Schema is the single source of truth.** Schemas live in `schemas/`. TypeScript types (for `packages/core` and `apps/mobile`) and Pydantic models (for `services/solver`) are **generated** from them in CI. A CI check fails if generated code is out of date. Nobody hand-edits generated code.
2. **Every document carries `schema_version`.** Breaking changes bump the major version and ship with a migration.
3. **Controlled vocabularies are enums, not free text:** operations, capabilities, allergens, diet flags, storage classes, units. Adding a value is a schema change.
4. **Canonical units.** Mass in grams, volume in milliliters, temperature in Celsius. Imperial is display-only conversion. Authoring durations are in minutes (decimals allowed, for example `1.5`); session plans store **integer seconds**, because the solver needs integers.
5. **Language-neutral IDs.** Ingredient and recipe IDs are stable ASCII slugs, never renamed. A retired ID gets `deprecated: true` and `replaced_by`.
6. **Derived data is never hand-written.** Recipe allergens, diet flags, required capabilities and macros are computed by a build step. The validator rejects files that set them by hand.
7. **Personal data stays out of the solver.** A solver request contains tasks with resolved durations, the kit, the concurrency cap and a time limit. The experience multiplier is applied client-side during expansion. It never contains body stats, allergies, or any user identifier.

## 2. Localization types

```yaml
# I18nString: content text. Both launch locales are required.
title: { en: "Chicken and rice", tr: "Tavuklu pilav" }
```

- Required locales come from `schemas/locales.json` (`["en", "tr"]` at launch). A build check fails if any `I18nString` in `data/` lacks a required locale or has an empty value.
- **Content** (ingredient names, recipe text, task coaching text, storage guidance) is inline in the data files.
- **UI strings** are not in data files. They live in `apps/mobile/locales/{en,tr}.json`, keyed by string ID.
- Ingredient `aliases` are `{ en: [..], tr: [..] }` arrays, used for search across both languages regardless of UI language.
- Turkish casing and collation rules from the PRD apply to any code that normalizes these strings.
- **Text placeholders.** Instruction text never contains raw amounts, temperatures or lengths. It uses: `{qty:<ingredient_id>}` (scaled amount with unit, ingredient must belong to the recipe), `{temp_c:N}` (authored in Celsius, rendered as C or F) and `{len_cm:N}` (rendered as cm or inches). Both locales of a string must contain the same placeholders.

## 3. Entities

### 3.1 Ingredient (`data/ingredients/*.yaml`, one file per ingredient)

| Field | Type | Notes |
|---|---|---|
| `id` | slug | For example `onion_yellow_raw`, `rice_white_long_raw`. Encodes the state (raw, dry, cooked). |
| `names` | I18nString | Display name. |
| `aliases` | `{locale: string[]}` | Search aliases, for example eggplant / aubergine / patlıcan. |
| `source` | object | `{ dataset: "usda_foundation" or "usda_sr_legacy", fdc_id, snapshot_date }`. Must point back to the upstream record. `dataset: example_placeholder` (with `fdc_id: null`) is allowed only under `docs/examples`; CI rejects it in `data/`. |
| `per_100g` | object | `kcal`, `protein_g`, `fat_g`, `carbs_g`, `fiber_g`, optional `sugar_g`, `sodium_mg`. Copied from the snapshot, then reviewed by hand. |
| `density_g_per_ml` | number, optional | For volume-to-mass conversion of liquids and powders. |
| `unit_weights` | list, optional | Countable items: `{ unit: "medium", grams: 110 }`. |
| `yield` | object, optional | Raw-to-cooked: `{ cooked_state: "boiled", mass_factor: 2.8 }` (cooked mass = raw mass x factor). Illustrative here; real values come from reviewed sources. |
| `allergens` | enum[] | Superset of EU and US lists (see the enums at the end of section 3). Ambiguous means include the allergen. |
| `diet_flags` | enum[] | For example `contains_meat`, `contains_fish`, `contains_pork`, `contains_alcohol`, `contains_animal_product`, `contains_gelatin`. |
| `shopping` | object | `{ section, pack_sizes_g[], staple: bool, skip?: bool }`. `section` is one of `produce`, `meat_fish`, `dairy_eggs`, `dry_goods`, `canned`, `frozen`, `bakery`, `spices_oils`, `other`, `none`. Water uses `section: none, skip: true`. |
| `edible_fraction` | number (0-1], default 1 | Share of the purchased weight that is used (peel, ends, bones removed). Shopping list only. |
| `portion_step_g` | number, default 5 | Smallest practical portioning increment (0.5 for spices, 1 for oil). |
| `validation` | object, optional | `{ kcal_check: exempt, reason }` exempts a high-fiber or concentrated ingredient from the calorie plausibility check. A reason is mandatory. |
| `deprecated`, `replaced_by` | optional | See principle 5. |

**Rule:** nutrition is always computed from **raw/as-listed** ingredient weights. Cooked weights are only for portioning and labels, via `yield`.

Example (values illustrative, real data comes from the USDA snapshot):

```yaml
schema_version: 1
id: rice_white_long_raw
names: { en: "White rice, long grain, raw", tr: "Pirinç, uzun taneli, çiğ" }
aliases: { en: ["rice"], tr: ["pirinç", "pilavlık pirinç"] }
source: { dataset: usda_sr_legacy, fdc_id: 169756, snapshot_date: "2026-09-01" }
per_100g: { kcal: 365, protein_g: 7.1, fat_g: 0.7, carbs_g: 80.0, fiber_g: 1.3 }
yield: { cooked_state: boiled, mass_factor: 2.8 }
allergens: []
diet_flags: []
shopping: { section: dry_goods, pack_sizes_g: [500, 1000, 2500], staple: false }
```

### 3.2 Recipe (`data/recipes/*.yaml`, one file per recipe)

| Field | Type | Notes |
|---|---|---|
| `id`, `version` | slug, int | `version` increments on any change that affects a plan. Sessions snapshot it. |
| `title`, `description` | I18nString | |
| `base_servings` | int | Quantities below are for this many servings. |
| `status` | enum | `draft`, `in_review`, `published`. Only `published` ships, and publishing needs a named reviewer for every required locale. |
| `ingredients[]` | list | `{ ingredient_id, grams, role, optional?, note?, portion_group?, follows? }`. `role` is `main`, `base`, `flex`, `seasoning`, `staple`. `portion_group` names components weighed together at wrap-up (no group means part of the mix, never weighed alone). `follows` makes a quantity scale with another ingredient's factor (water follows rice). |
| `scaling` | object | Portion flexibility (see below). |
| `tasks[]` | list | The task graph (3.3). |
| `storage` | object | `{ fridge_days, freezer_days or null, cooling_note, reheat }` with text as I18nString. Conservative values only. |
| `authoring` | object | `{ author, reviewed_by, reviewed_at }`, where `reviewed_by` is a map from locale to reviewer. A recipe cannot be published without an entry for each required locale. |

**Scaling.** The planner scales portions instead of changing recipes. Each recipe declares:

```yaml
scaling:
  min_factor: 0.75      # smallest whole-recipe portion factor
  max_factor: 1.5
  flex:                 # components that may flex further, per ingredient
    - { ingredient_id: rice_white_long_raw, min_factor: 0.5, max_factor: 2.0 }
```

The planner only offers portions inside these ranges and says plainly when a target can't be reached.

**Derived fields** (generated into `data/generated/recipes/`, never hand-written): `allergens`, `diet_flags`, `required_capabilities`, `macros_per_serving`, `prep_estimate` (a rough active-time proxy for library browsing).

### 3.3 Task (inside a recipe)

A task is one atomic step at the granularity "cut up the onions", about 10-20 per recipe. A task has an **active phase** followed by an optional **passive phase**. If a step needs attention at the end (take the tray out), it is a separate follow-up task.

| Field | Notes |
|---|---|
| `id` | Unique within the recipe. |
| `op` | Enum: `wash`, `peel`, `dice`, `slice`, `mince`, `mix`, `season`, `marinate`, `sear`, `saute`, `simmer`, `boil`, `roast`, `bake`, `steam`, `blend`, `rest`, `cool`, `portion`, `store`, `unload`. Adding an operation is a schema change. |
| `inputs` / `outputs` | `inputs` lists ingredient IDs and intermediates, and each intermediate must be produced by an **ancestor** task. `outputs` names the intermediates the task creates and lives on the **task**, so every method produces the same outputs by construction. The mass basis for `per_100g_min` is the full recipe grams of the source ingredients behind the inputs, each counted once. |
| `needs` | Task IDs that must finish first. The graph must be acyclic. |
| `hold_max_min` | Optional. Maximum time between this task ending and a dependent starting. Set on the **predecessor** whose result waits. |
| `hold_kind` | Required with `hold_max_min`: `safety`, `quality` or `continuity` (see the authoring guide). `continuity` holds must be 5 minutes or less. Slack tightening applies only to `safety` and `quality`. |
| `on_hold_exceeded` | Required for `safety` holds: `{ action: refrigerate or keep_covered or discard_advice, text: I18nString }`, reviewed for food safety in every locale. |
| `optional` | bool, default false. Only optional tasks may be `skipped` in cook mode. |
| `batch_key` | Optional, for example `dice:onion_yellow_raw`. Tasks with the same key across recipes may be merged. |
| `methods[]` | One or more (3.4). |
| `text` | Coaching text (3.5). |

### 3.4 Method (inside a task)

```yaml
methods:
  - id: stovetop
    baseline: true              # exactly one baseline per task
    requires:
      - { capability: heat_source, count: 1 }
      - { capability: pot, min_liters: 2 }
    active:  { fixed_min: 3, per_100g_min: 0 }
    passive: { fixed_min: 18 }
  - id: rice_cooker
    requires: [{ capability: rice_cooker }]
    active:  { fixed_min: 1 }
    passive: { fixed_min: 30 }
    quality: better             # same | better
```

- **Baseline rule:** exactly one method per task is `baseline: true` and may only require *basic* capabilities (assumed kit, `heat_source`, `oven`, `pot`, `pan`). Accelerator methods require optional appliances.
- **Duration model:** `fixed_min + per_100g_min * mass_100g` (or `per_unit_min * count`) for the active phase. The passive phase can scale the same way, or use `scales: false` for cases like roasting where 4 trays take as long as 1 (subject to tray capacity).
- **Oven requirements:** `{ capability: oven, temp_c: 200, tolerance_c: 15, trays: 1 }`. The scheduler may share the oven between tasks whose temperature ranges overlap. Preheat time is scheduler-derived.
- **Equivalence rule:** all methods of a task produce identical `outputs` and identical nutrition. A method that changes ingredients (for example less oil) must be a separate recipe.
- **`passive_unattended`** (bool, default false): true only if the food needs no attention at all during the passive phase. It decides whether the phase counts toward the concurrency cap.
- **`max_batch_g`** (optional): most input mass the method can process in one run. Methods whose capacity is below the task's resolved mass are removed during expansion, and merges respect it.
- **`text`** (optional): coaching text that overrides the task's text for this method. Required in practice whenever the physical steps differ.
- **Requirement `phases`** (optional, `active` and/or `passive`, default both): the phases in which a requirement occupies the resource.
- **`quality`** (`same` or `better`) records why an accelerator exists.
- **Monotonicity:** adding equipment must never make a plan worse. This is enforced by a property test in the scheduler suite, not by the schema.

### 3.5 Coaching text

```yaml
text:
  brief:    { en: "Dice the onions.", tr: "Soğanları doğrayın." }
  detailed: { en: "Dice the onions into roughly 1 cm pieces. Halve them, lay them flat, then slice and cross-cut.",
              tr: "Soğanları yaklaşık 1 cm'lik küpler halinde doğrayın. Yarıya bölüp düz yüzeyine yatırın, dilimleyin, sonra çapraz kesin." }
```

`brief` is shown to experienced cooks, `detailed` to beginners. Both are required.

### 3.6 Equipment and capabilities (`schemas/capabilities.json`)

Recipes require **capabilities**, never appliance names. Appliances provide capabilities, so induction, gas and electric hobs all provide `heat_source`.

| Tier | Contents | Collected |
|---|---|---|
| Assumed | knife, board, bowls, one pot, one pan | Never asked |
| Quantified | `heat_source` (burner count), `oven` (yes/no, trays, max temp), `pot`/`pan` sizes | Asked in onboarding |
| Optional accelerators | `rice_cooker`, `slow_cooker`, `pressure_cooker`, `air_fryer`, `food_processor`, `blender`, `stand_mixer` | Checkboxes |

Oven capability configuration includes `preheat_s` (default 600). User equipment is a list: `{ capability, count?, trays?, sizes_l?[] }`. A recipe is **available** to a user only if every task's baseline method is satisfiable by their kit. Otherwise it is hidden from their library.

### 3.7 UserProfile (stored on device in the MVP, see section 6)

| Field | Notes |
|---|---|
| `locale`, `units` | `en` or `tr`; `metric` or `imperial`. |
| `birth_year` | Adults only (18+). A younger value blocks target generation. |
| `sex_for_calculation`, `height_cm`, `weight_kg`, `body_fat_pct?` | Inputs to BMR (Mifflin-St Jeor, or Katch-McArdle if body fat is given). `sex_for_calculation` is `male`, `female` or `unspecified` (midpoint constant, stricter calorie floor). It is a formula input, not an identity field. |
| `activity_level` | Enum. |
| `goal` | `{ type: lose or maintain or gain, weekly_rate_kg }`, clamped by the safety rails. |
| `targets` | Computed `{ kcal, protein_g, fat_g, carbs_g }` plus `computed_at`. |
| `targets_mode` | `computed`, `manual` or `none`. In `none` mode the body fields, goal and targets are absent. |
| `allergens`, `diet`, `dislikes[]` | Allergens and diet are hard constraints. Dislikes are soft. |
| `equipment` | See 3.6. |
| `experience` | `{ level: beginner or comfortable or experienced, speed_multiplier, concurrency_cap, slack_s }`, defaults per level. |
| `pantry[]` | `{ ingredient_id, grams? }` for shopping list subtraction. No grams means "have plenty". |
| `target_weight_kg?` | Optional. Used to suggest switching to maintenance. |
| `meals_per_day`, `slot_shares[]` | 2-6 meals (default 3) and each slot's share of the daily targets (sum 100%). |
| `health_gate` | Sensitive, device-only. The answer to the pregnancy, breastfeeding or medical-condition question. Disables computed targets. |
| `hide_disliked` | bool. Hide instead of badge recipes containing disliked ingredients. |
| `baseline_session_min?` | Optional self-reported usual prep-session length (bucketed when uploaded as a metric). |
| `telemetry_consent` | `{ given, at, text_version }`. Default not given. |
| `install_id` | Random, resettable, unrelated to any device identifier. Used only for opt-in metrics. |

Safety rails (calorie floor, rate cap) are enforced in code in `packages/core` and covered by tests. They are specified in the planning layer spec, not here.

### 3.8 SessionPlan (generated)

The plan is an **instance**: recipes chosen, quantities fixed, methods selected, tasks placed on a timeline.

| Field | Notes |
|---|---|
| `id`, `created_at`, `schema_version` | |
| `recipes[]` | `{ recipe_id, recipe_version, servings }`. **Snapshots the version**, so later recipe edits never change a plan mid-cook. |
| `kit_snapshot`, `experience_snapshot` | The equipment and multiplier the plan was built with. |
| `batches[]` | `{ batch_key, member_task_refs[], merged_grams }` |
| `items[]` | Scheduled task instances (below). |
| `totals` | `{ elapsed_s, active_s, idle_s }` |
| `provenance` | `{ producer: cp_sat or greedy or local_repair, solver_version, time_limit_s, objective }` |
| `verification` | `{ verifier_version, passed, violations[] }`. A plan with `passed: false` must never be shown to a user. |
| `revisions[]` | Later plans produced by live repair, each with provenance `local_repair`. The original is kept. |
| `render_bundle` | Denormalized snapshot of every recipe, ingredient name, step text (all required locales) and storage text the plan uses, so cook mode is fully offline and immune to content updates. |

Each item in `items[]`:

```yaml
- item_id: it_014
  task_ref: { recipe_id: chicken_pilaf, task_id: dice_onion }   # or batch_ref for a merged group
  method_id: stovetop
  active:  { start_s: 0,    end_s: 420 }
  passive: { start_s: 420,  end_s: 1500 }        # optional
  resources: [{ capability: heat_source, unit: 1 }]
  depends_on: [it_009]
```

Times are seconds from session start. Absolute clock times are assigned only when cook mode starts, and timers store **absolute end timestamps**, never countdowns.

### 3.9 SessionRecord (execution data)

Recorded from day one, even though only the post-session suggestion uses it in the MVP.

| Field | Notes |
|---|---|
| `session_id`, `started_at`, `ended_at` | |
| `item_records[]` | `{ item_id, planned_start_s, planned_end_s, shown_at, first_view_at, actual_end_at, sole_focus: bool, paused_s, suspicious: bool }`. `shown_at` is when the item became the current card, and `actual_active_s = actual_end_at - shown_at - paused_s` (one-tap capture, cook mode spec section 5). |
| `events[]` | `behind_pressed`, `local_repair_applied`, `timer_fired`, `timer_dismissed`, and so on, with timestamps. |
| `outcome` | `{ completed: bool, actual_elapsed_s }` |
| `adjustment` | `{ suggested_multiplier, accepted: bool }` (optional) |
| `pace_feedback` | Optional `too_fast`, `about_right` or `too_slow`. |
| `mise_s` | Time spent in mise en place, measured separately from cooking. |
| `revisions[]` | Plan revisions applied during the session, with provenance. |

`sole_focus` marks whether the task was the user's only active focus, so the speed estimator can trust it (see the scheduler spec).

### 3.10 Containers and LogEntry

- **Container** (created in the wrap-up): `{ id, session_id, recipe_id, label, cooked_grams, macros, storage: fridge or freezer, use_by }`. Macros are computed from raw ingredient grams allocated to the container, never estimated from cooked weight.
- **LogEntry:** `{ id, at, local_date, kind: plan or other, container_id?, fraction?, kcal, protein_g?, fat_g?, carbs_g? }`. `local_date` is the device-local date at entry time, and `fraction` (default 1) scales a plan entry's macros. `plan` entries copy the container macros. `other` entries are user-typed.

### 3.11 Other entities

- **SchedulingProblem** (`schemas/scheduling-problem.schema.json`): the fully resolved input to the solver, greedy scheduler and verifier. Shape and rules are in the scheduler spec, section 4. It contains no personal data.
- **Timer:** `{ id, item_id, kind: passive or user or hold_warning, label_key, end_at (absolute UTC ms), created_at, state: running or fired or acknowledged or cancelled }`.
- **CookSession:** `{ id, state, plan_id, plan_revision, t0, item_states, timers[], events[], render_bundle_ref }`, persisted on every transition (cook mode spec section 2).
- **WeightEntry:** `{ id, date, kg }`, optional and opt-in.
- **TelemetryEvent** (`schemas/telemetry-event.schema.json`): an allowlist of fields (PRD section 7). The client can only emit events that validate against it.
- **DietRules** (`schemas/diet-rules.json`): maps each diet rule to the `diet_flags` it excludes.

### Allergen and diet enums (superset)

`allergens`: `celery`, `gluten_cereals`, `wheat`, `crustaceans`, `eggs`, `fish`, `lupin`, `milk`, `molluscs`, `mustard`, `peanuts`, `sesame`, `soybeans`, `sulphites`, `tree_nuts`. This is the union of the EU list (14) and the US list (9). `wheat` is kept separately because US labeling names it, even though it also implies `gluten_cereals`.

MVP diet rules are modeled as exclusions over `diet_flags`: vegetarian, vegan, pescatarian, and a "no pork or alcohol" rule. Meat sourcing (halal or kosher slaughter) can't be verified by the app and is the user's responsibility. Full kosher handling, including meat and dairy separation, is out of the MVP (see open items).

## 4. Validation layers

1. **Structural:** JSON Schema validation of every file in `data/`.
2. **Semantic (build step), fails CI:**
   - Every `ingredient_id` in a recipe exists and is not deprecated without a replacement.
   - The task graph is acyclic, and `needs` references resolve.
   - Every task has exactly one baseline method, and it requires only basic capabilities.
   - All methods of a task declare identical `outputs`.
   - `batch_key` values reference real ingredients and ops.
   - Both required locales are present and non-empty everywhere.
   - Derived fields are absent from hand-authored files.
   - Ingredient macros are internally plausible (kcal within about 10% of 4P + 4C + 9F, with an exceptions list).
   - Recipe portion ranges are sane (`min_factor < 1 <= max_factor`, flex ranges contain 1).
   - Every intermediate an input refers to is produced by an ancestor task, and every recipe ingredient is used by at least one task input.
   - `hold_max_min` requires `hold_kind`, `safety` holds require `on_hold_exceeded`, and `continuity` holds are 5 minutes or less.
   - Text placeholders are well formed, refer to recipe ingredients, are identical across locales, and no raw amounts, temperatures or lengths appear in text.
   - `published` recipes have a reviewer for every required locale.
   - `source.dataset: example_placeholder` never appears in `data/`.
   - A prototype of these rules is in `docs/examples/validate_examples.py`.
3. **Plan-level:** the independent verifier (specified in the scheduler spec) validates every SessionPlan.

## 5. Repository mapping

```
schemas/
  ingredient.schema.json  recipe.schema.json  task.schema.json
  session-plan.schema.json  session-record.schema.json
  user-profile.schema.json  capabilities.json  locales.json
  scheduling-problem.schema.json  telemetry-event.schema.json  diet-rules.json
data/
  ingredients/  recipes/  generated/
apps/mobile/locales/{en,tr}.json      # UI strings only
packages/core/generated/              # TS types (generated)
services/solver/generated/            # Pydantic models (generated)
```

Codegen tools are an implementation choice for Claude Code (for example `json-schema-to-typescript` and `datamodel-code-generator`). The requirement is that generation is deterministic and CI-checked.

## 6. Assumptions and open items

- **Decision: local-first storage for the MVP.** User profile, sessions, records and logs live on the device (SQLite). No accounts and no cross-device sync at launch. Body stats are sensitive personal data, and keeping them on-device avoids a backend user store while the core is validated. The solver service stays stateless. **Export and import** of all user data (a single versioned JSON file matching these schemas) is in scope as a safety valve against a lost or replaced phone. Accounts and sync are a later migration.
- **Open:** kosher handling and any diet rule beyond the MVP list.
- **Open:** exact numeric values for the experience levels (multiplier, concurrency cap, slack). These belong in the scheduler spec and need real session data to tune.
- **Open:** pack-size and store-section data for the shopping list is authored per ingredient, and will need regional variation later.
