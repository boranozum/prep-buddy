# Prep Buddy: Recipe Authoring Guide

Status: DRAFT v0.1 (for review). Lives at `docs/recipe-authoring-guide.md`.
Depends on: `docs/data-model.md`, `docs/scheduler-spec.md`, `docs/planning-spec.md`, `docs/cook-mode-spec.md`.
Companion files: `docs/examples/` (15 ingredient files, 3 recipe files, and a prototype validator).

This guide is for anyone who turns a recipe into Prep Buddy's structured format: a human author, a reviewer, or an LLM (including Claude Code) drafting for human review. The structure is what lets the scheduler run several recipes in parallel, so **the quality of these files is the quality of the product**. A wrong duration or a missing dependency becomes a wrong instruction in someone's kitchen.

---

## 1. Workflow

```
draft  ->  validate (schema + semantic checks)  ->  technical review  ->  food-safety review
       ->  language review (each locale)  ->  publish
```

| Status | Meaning |
|---|---|
| `draft` | Being written. May be LLM-drafted. Never shown to users. |
| `in_review` | Passed automated validation. Awaiting the reviews below. |
| `published` | Has a named reviewer for **every required locale** and passed all checks. Only this status ships. |

**Rules**
1. **Nutrition is never authored.** It is derived from the canonical ingredient table. Authors supply grams, never calories.
2. **Derived fields are never hand-written:** `allergens`, `diet_flags`, `required_capabilities`, `macros_per_serving`, `prep_estimate`. Validation rejects them.
3. **An LLM may draft, never publish.** LLM output enters as `draft`. Every duration, temperature, storage period and food-safety statement in it must be checked by a human against the timing protocol (section 5) and a food-safety reference.
4. **Both locales are required** in every text field. A recipe with one language missing fails validation.
5. **Change control.** Any edit that could change a plan (quantities, tasks, durations, methods, holds) increments `version`. Sessions snapshot the version they were built from.

## 2. Files and naming

- `data/ingredients/<id>.yaml`: one file per ingredient. `data/recipes/<id>.yaml`: one file per recipe. File name equals `id`.
- IDs are ASCII `snake_case`, stable forever, and **never renamed** (deprecate with `replaced_by` instead).
- **Ingredient IDs encode the state** of the food as measured: `chicken_breast_raw`, `rice_white_long_raw`, `red_lentils_dry_raw`. Recipe grams always refer to that state.
- **Task IDs** are unique within a recipe, verb-first (`dice_onion`, `sear_chicken`).
- **Intermediates** are the named things tasks make (`diced_onion`, `cooked_pilaf`). They are `snake_case` nouns and are declared as a task's `outputs`.

## 3. Recipe anatomy

See `docs/data-model.md` for the field reference. In short: metadata, `base_servings`, an `ingredients` list (grams, role, optional `portion_group` and `follows`), a `scaling` block, a `tasks` list, `storage`, and `authoring`.

**Roles:** `main`, `base`, `flex` (an ingredient that may flex more than the rest, like rice), `seasoning`, `staple` (oil, water).
**Water and other liquids** are listed as ingredients (with zero nutrition and `shopping.skip: true`) so step text can show their scaled amount. Use `follows: <ingredient_id>` so they scale with the ingredient they belong to.

## 4. Designing the task graph

### 4.1 Granularity
- Roughly **10-20 tasks** per recipe, each one a single kind of activity a person can start and finish with one tap: "dice the onion", not "prepare the vegetables". Too coarse hides batching opportunities. Too fine buries the cook in taps.
- Every task has an **active phase** (hands busy) followed by an optional **passive phase** (food cooks or rests alone). If attention is needed at the **end** of a passive phase, that attention is **its own task**: `roast_veg` (passive) then `unload_veg` (active). Do not hide it in the passive time.
- **Include the wrap-up.** Cooling, portioning and storing are ordinary tasks, so hold limits and timers apply to them like any other step.

### 4.2 Inputs and outputs
- `inputs` lists ingredient IDs and/or intermediates. `outputs` lists the intermediates the task creates.
- Every intermediate an input refers to must be produced by an **ancestor** task. Every recipe ingredient must be used by at least one task input. The validator checks both.
- The **mass basis** for `per_100g_min` is the total grams of the *source ingredients* behind the task's inputs (intermediates resolve back to their ingredients), each counted once and at its full recipe quantity.
- **Outputs live on the task, not on the method.** That makes the equivalence rule structural: every method of a task produces the same outputs.

### 4.3 Operations
`wash`, `peel`, `dice`, `slice`, `mince`, `mix`, `season`, `marinate`, `sear`, `saute`, `simmer`, `boil`, `roast`, `bake`, `steam`, `blend`, `rest`, `cool`, `portion`, `store`, `unload`. Adding an operation is a schema change. Prefer an existing one.

## 5. Timing

- **Author for the reference cook**: a competent home cook (experience multiplier 1.0). The app scales active time for other levels. Passive time and hold limits never scale with experience.
- **Measure, don't guess.** Cook the recipe **at least twice** with a stopwatch per task, at the base servings. Use the **median** for active time. Round passive time **up** to the next minute and hold limits **down**. Note the equipment used.
- **Active vs. passive.** Active is time your hands are busy. Simmering under a lid is passive, but it is **attended** (`passive_unattended: false`, the default). Set `passive_unattended: true` only when the food needs *no attention at all* for the whole phase (oven roasting, a rice cooker cycle, soaking, cooling). This flag decides how many things a beginner can juggle.
- **Fixed vs. per-unit.** `fixed_min` is setup and cleanup that doesn't grow with quantity. `per_100g_min` grows with the mass basis. Dicing is mostly per-unit, roasting is fixed.
- **`scales: false`** on a passive phase means the time doesn't grow with quantity (4 trays roast as long as 1, up to tray capacity). Roasting, soaking, cooling and simmering usually use it.
- Use decimals with half-minute granularity at most (`1.5`).

## 6. Methods

Each task has one or more **methods**: ways to do the task with different equipment.

- **Exactly one baseline** (`baseline: true`) per task. It may require only **basic capabilities** (`heat_source`, `oven`, `pot`, `pan`), plus the assumed kit (knife, board, bowls) which is never listed. If the user's kit can't satisfy the baseline of every task in a recipe, the recipe is hidden from them.
- **Accelerators** require optional appliances (`rice_cooker`, `slow_cooker`, `pressure_cooker`, `air_fryer`, `food_processor`, `blender`, `stand_mixer`). Add one only if it changes something real: **less hands-on time, more unattended time, a freed burner, or better quality.** Record what changes in `quality: same | better`.
- **Equivalence rule:** every method produces the same outputs, and therefore the same ingredients and nutrition. A method that needs different ingredients (for example less oil) is a **different recipe**.
- **Accelerators must never make a plan worse.** If a method would be slower and no better, don't add it.
- **Method text.** If an accelerator changes what the person physically does ("move everything to the rice cooker"), give the method its own `text`. Otherwise the task's text is used.
- **Capacity.** `max_batch_g` is the most input mass the method can process in one run (an air-fryer basket, a rice cooker). A method whose capacity is below the task's resolved mass is removed during expansion, and the task falls back to another method.
- `blender` covers both hand (immersion) and jug blenders.

## 7. Resource requirements

Requirements are **capabilities**, never appliance names, so gas, induction and electric hobs all satisfy `heat_source`.

| Requirement | Meaning |
|---|---|
| `{ capability: heat_source, count: 1 }` | One burner, for the whole task (active and passive) unless `phases` narrows it |
| `{ capability: pot, min_liters: 3 }` | A pot of at least that size |
| `{ capability: pan }` | A frying or sauté pan |
| `{ capability: oven, temp_c: 200, tolerance_c: 15, trays: 1 }` | Oven use. Tasks whose temperature ranges overlap can share the oven. `tolerance_c` is how far the dish can move from `temp_c` without harm. Use the widest honest tolerance, since it lets the scheduler share the oven. |
| `{ capability: rice_cooker }` | An appliance capability, no quantity |

Reserve resources **for exactly as long as they are physically in use**. A simmer that continues covered off the heat can still reserve the burner (conservative), and the guide's pilaf does so on purpose (its 25 minutes include a covered rest).

## 8. Vessel continuity (an important limitation)

The scheduler tracks how many pots are in use, **not which pot** holds which food. When one step continues in the same vessel as the previous one (sauté the onions, then toast the rice in the same pot), the scheduler could in principle slot an unrelated task into the gap. Two authoring rules approximate continuity:

1. Give the earlier task a **continuity hold**: `hold_max_min` of **5 minutes or less** with `hold_kind: continuity`. This forces the next step to follow almost immediately.
2. If an accelerator replaces the vessel, **keep the whole vessel-bound sequence inside one task** so the methods stay comparable. In the pilaf, the stovetop simmer plus covered rest is one 25-minute task, and the rice cooker method is a single 35-minute task. Splitting "simmer" and "rest" into two tasks would break when the rice cooker replaces the pot.

Explicit vessel linking is a possible post-MVP improvement (see open items).

## 9. Batch keys

A `batch_key` says "these tasks are the same job and may be merged across recipes". Format: `<op>:<ingredient_id>`, and the op must equal the task's op.

- **The key must imply an identical cut and treatment.** `dice:onion_yellow_raw` in the pilaf and the soup merge. The sheet-pan recipe cuts onion into wedges, so it uses `slice:onion_yellow_raw` and never merges with them.
- Merging counts fixed time **once** and sums per-unit time. In the examples, dicing onion separately takes 5.1 minutes for the pilaf and soup, and merged it takes 3.6 (saves 1.5 minutes).
- Merging is **undone** by the scheduler if it would break a hold limit (for example onions diced far too early). Authors don't need to do anything for that, but must set honest hold limits.
- If a method has a capacity limit (`max_batch_g`), merging respects it.
- Omit `batch_key` on tasks that are not repeatable across recipes (portioning, storing).

## 10. Hold limits

`hold_max_min` on a task means: **this task's output may wait at most this long before a dependent step starts.** It goes on the **predecessor** (the task whose result waits), never on the step that follows.

Every hold has a `hold_kind`:

| Kind | Purpose | Examples in the recipes | Extra requirements |
|---|---|---|---|
| `safety` | Food-safety time at unsafe temperatures | Seared chicken waiting (20), rice or soup waiting to be portioned and cooled (15, 30) | **`on_hold_exceeded`** with `action` (`refrigerate`, `keep_covered`, `discard_advice`) and reviewed text in both locales |
| `quality` | The result gets worse but stays safe | Pilaf waiting to be fluffed (10), vegetables drying in the oven (15) | none |
| `continuity` | Approximates staying in the same vessel (section 8) | Onion to rice (2), soup to purée (5) | 5 minutes or less |

**Choosing values.** Be conservative, and ask a food-safety reviewer to confirm every `safety` value against an authoritative reference. A hold limit applies to one edge only. **Cumulative time at unsafe temperatures across a chain is not modeled**, so authors must choose per-edge values whose *sum* stays inside safe limits (for example cooling time plus the wait before refrigeration).

The scheduler's slack buffer tightens `safety` and `quality` holds only. It never tightens `continuity` holds.

## 11. Scaling, flex and portioning

- `scaling.min_factor` and `max_factor`: how much the **whole portion** may shrink or grow while the recipe still works. Typical range 0.75 to 1.5. Test the extremes by actually cooking them, since pans overcrowd and cooking times change.
- `flex`: ingredients that may vary more than the rest (rice in a pilaf, potatoes in a tray bake). The planner uses them to hit macro targets without changing the cooking process. A flex range must contain 1.
- `follows`: a liquid that scales with an ingredient's factor (water follows rice).
- `portion_group`: components weighed together at wrap-up. Ingredients with no group are part of the mix and never weighed alone (oil, salt).
- **Yields.** Cooked-weight targets use `yield.mass_factor` per ingredient, which is only an estimate. The wrap-up's "weigh the batch" step is the source of truth, so a rough yield is acceptable.
- **Rounding.** `portion_step_g` on the ingredient sets the smallest practical increment (5 g default, 0.5 g for spices, 1 g for oil).

## 12. Ingredients

- **Source.** Each canonical ingredient points to a USDA Foundation or SR Legacy record (`source.dataset`, `fdc_id`, `snapshot_date`), and values are copied from the snapshot and reviewed by hand.
- **`example_placeholder` sources** appear only in `docs/examples`. CI rejects them under `data/`.
- **Allergens** use the EU and US superset. Ambiguous means include. Missing allergen data is a build failure, not an empty list.
- **Diet flags** describe what's in the ingredient (`contains_meat`, `contains_pork`, and so on), and recipe flags are derived.
- **`edible_fraction`** (peel, ends, bones removed) is for the shopping list only. Recipe grams are as-used weights.
- **`unit_weights`** let the shopping list say "3 onions".
- **Plausibility check.** Calories should be within about 10% of `4P + 4C + 9F`. High-fiber spices and concentrates may carry `validation: { kcal_check: exempt, reason: ... }`. An exemption always needs a reason.
- **Names and aliases** are required in both languages (for example patlıcan, eggplant, aubergine). Turkish aliases should include the everyday words people search for.
- Water: `shopping: { section: none, skip: true }`, zero nutrition.

## 13. Writing the text

**Structure.** Every task has `text.brief` (for experienced cooks) and `text.detailed` (for beginners). Both are required in both locales. Step titles (`brief`) should be about six words or fewer.

**Never hard-code amounts.** Amounts, temperatures and lengths change with servings and the user's units, so text uses placeholders:

| Placeholder | Renders as | Notes |
|---|---|---|
| `{qty:<ingredient_id>}` | The scaled amount with unit, for example "240 g" or "8.5 oz" | The ingredient must be in this recipe |
| `{temp_c:200}` | "200 °C" or "392 °F" | Value is authored in Celsius |
| `{len_cm:1}` | "1 cm" or "0.4 in" | |

Both locales must contain **the same placeholders**. The validator flags raw numbers with units in text.

**English style.** Imperative, short sentences, one action per sentence, no idioms.

**Turkish style.**
- Use the polite plural imperative (`doğrayın`, `karıştırın`), consistently.
- Use standard culinary verbs (glossary below). Avoid anglicisms unless they are the common word (`airfryer`).
- Don't translate word for word: restructure the sentence naturally. Turkish strings run longer, so keep them tight.
- Let a **fluent reviewer** check every string. Safety text (`on_hold_exceeded`, storage, doneness temperatures) needs particular care.

Starting glossary (for reviewer confirmation):

| Op | English | Turkish |
|---|---|---|
| wash | rinse | yıkamak |
| peel | peel | soymak |
| dice | dice | küp küp doğramak |
| slice | slice | dilimlemek |
| mince | mince | ince ince doğramak |
| mix | mix, toss | karıştırmak |
| season | season | baharatlamak, tuzlamak |
| marinate | marinate | marine etmek |
| sear | sear | mühürlemek |
| saute | sauté | kavurmak |
| simmer | simmer | kısık ateşte pişirmek |
| boil | boil | kaynatmak |
| roast / bake | roast / bake | fırında pişirmek |
| blend | blend | blenderdan geçirmek |
| rest | rest | dinlendirmek |
| cool | cool | soğutmak |
| portion | portion | porsiyonlamak |
| store | store | saklamak |
| unload | take out | çıkarmak |

## 14. Storage and food safety

- `fridge_days`, `freezer_days` (or `null` when freezing is not recommended, as for roasted potatoes), `cooling_note` and `reheat` are required.
- Values are **conservative**. Reviewers confirm them against a current food-safety reference. The example values are illustrative.
- Cooling should be shown as a task (spread out, shallow containers) with a `safety` hold to refrigeration.
- Doneness guidance in text (for example the internal temperature of poultry) needs a reviewer's confirmation.

## 15. Review checklist

**Author**
- [ ] Cooked it at least twice, timing every task with a stopwatch (medians used)
- [ ] All grams are as-used weights in the state named by the ingredient ID
- [ ] Every intermediate has a producer, every ingredient is used
- [ ] Attention-at-the-end steps are separate tasks (take-outs, fluffing)
- [ ] Wrap-up tasks (cool, portion, store) are present

**Technical**
- [ ] Validator passes with no errors
- [ ] One baseline per task, using only basic capabilities
- [ ] Accelerators genuinely reduce time, attention or contention
- [ ] `passive_unattended: true` only where no attention is needed at all
- [ ] Batch keys imply identical cuts
- [ ] Vessel-bound sequences follow section 8
- [ ] Scaling extremes cooked at least once

**Food safety**
- [ ] Every `safety` hold has an authored fallback action
- [ ] Per-edge holds sum to a safe chain (section 10)
- [ ] Storage periods and doneness statements confirmed against a reference
- [ ] Allergens and diet flags reviewed for the derived recipe result

**Language (each locale, by a fluent reviewer)**
- [ ] Placeholders identical across locales, no raw amounts
- [ ] Natural phrasing, consistent verbs, titles short
- [ ] Safety text double-checked
- [ ] Ingredient names and aliases reviewed

## 16. Common mistakes

| Mistake | Why it hurts | Fix |
|---|---|---|
| Amount typed into text ("add 500 g water") | Wrong when servings or units change | Use `{qty:...}` |
| Accelerator changes ingredients | Silently changes nutrition | Make it a separate recipe |
| Baseline requires an accelerator | Recipe hidden from users without it | Provide a basic baseline |
| `passive_unattended: true` on a simmer | Beginners get overloaded | Leave the default (attended) |
| Hold limit on the wrong task | Never triggers, or triggers on the wrong edge | Put it on the predecessor whose result waits |
| Batch key across different cuts | Merges tasks that shouldn't merge | Use a different op or ingredient key |
| Take-out hidden inside a passive phase | Nothing prompts the user | Separate `unload` task |
| Vessel-bound steps split across tasks | Plan may use the pot elsewhere in the gap | Continuity hold or one combined task |
| Overly optimistic freezer days | Food-safety and quality risk | Conservative values, reviewer sign-off |
| Copying English sentence structure into Turkish | Reads as machine-translated | Rewrite naturally, then review |
| Timing guessed, not measured | Bad plans, bad speed data | Cook it twice with a stopwatch |

## 17. The worked examples (`docs/examples/`)

| Recipe | Teaches |
|---|---|
| **A. `chicken_pilaf`** (Tavuklu pilav, stovetop) | Batch key, flex rice, `follows` for water, a rice cooker accelerator with its own text and `max_batch_g`, safety, quality and continuity holds, cooling and storage tasks |
| **B. `red_lentil_soup`** (Mercimek çorbası, stovetop) | A baseline with no special appliance plus a blender accelerator, a pressure cooker accelerator with a safety note and capacity, batching with recipe A (`dice:onion_yellow_raw`), a cooling hold |
| **C. `sheet_pan_chicken_veg`** (oven at 200 C) | Oven requirement with tolerance and trays, roast split from take-out, an air fryer accelerator, a batch key that must *not* merge, a recipe hidden from users without an oven, `freezer_days: null` |

**Run the prototype validator:** `python3 validate_examples.py` (needs `pip install pyyaml`). It checks the rules in this guide and prints derived data. Its output for the examples, hand-checked, is the **fixture set** for the real build step and scheduler tests. **All ingredient values are illustrative and must be replaced with reviewed USDA data before anything enters the library.**

| Recipe | Tasks | Per serving (kcal / protein / fat / carbs, g) | Hands-on (min) | Passive (min) | Critical path (min) | Baseline capabilities |
|---|---|---|---|---|---|---|
| chicken_pilaf | 13 | 459.5 / 38.5 / 9.4 / 51.8 | 38.5 | 60.0 | 78.3 | heat_source, pan, pot |
| red_lentil_soup | 10 | 304.5 / 15.9 / 7.2 / 46.4 | 33.3 | 50.0 | 79.9 | heat_source, pot |
| sheet_pan_chicken_veg | 12 | 471.1 / 43.9 / 16.3 / 36.3 | 34.7 | 92.0 | 83.0 | oven |

(Critical path ignores resource limits. Values are for the reference cook at base servings, using illustrative data.)

**Why this matters, in numbers.** Cooked one after another, the three recipes take roughly the sum of their critical paths: 78.3 + 79.9 + 83.0 = **241 minutes, about 4 hours**, which is exactly the pain this product targets. With one cook, total hands-on time is 38.5 + 33.3 + 34.7 = **106.5 minutes**, and no schedule can beat that. So the theoretical best is about **1 hour 45 minutes**, and the scheduler's job is to land close to it. That is the origin of the "3-4 hours down to about 2" claim, and these numbers will be the first benchmark set once the scheduler exists.

**Expected validator facts** (also good test assertions):
- All three recipes have empty `allergens` (with the illustrative ingredient data).
- Diet flags: A and C are `contains_meat` and `contains_animal_product`. B has none, so it is vegan under the MVP diet rules.
- Required capabilities: A `heat_source`, `pan`, `pot`. B `heat_source`, `pot`. C `oven`.
- Without an oven, C is filtered out of the library. A and B remain.
- The `dice:onion_yellow_raw` batch across A and B saves 1.5 minutes.

## 18. Appendix: LLM drafting prompt template

For Claude Code or another assistant drafting a recipe for human review:

> Draft a Prep Buddy recipe file in the format of `docs/examples/recipes/`, following `docs/recipe-authoring-guide.md`.
> Source recipe: `<paste>`. Base servings: `<n>`. Use only ingredient IDs that exist in `data/ingredients/`, and list any new ingredients you need as a separate list without inventing nutrition values.
> Rules: no nutrition, allergen or diet fields; both `en` and `tr` text; placeholders instead of amounts; 10-20 tasks; separate take-out and wrap-up tasks; one baseline method per task; `hold_kind` on every hold; `status: draft`.
> Mark every duration, temperature and storage period with `# VERIFY` in a comment. Do not claim any value has been tested.

## 19. Schema and spec follow-ups introduced by this guide

Already folded into `docs/data-model.md` v0.2 and `docs/scheduler-spec.md` (listed here for traceability):

**Data model**
- Recipe: `status`; `ingredients[].follows`; `ingredients[].portion_group`; `authoring.reviewed_by` as a locale-to-reviewer map (replacing `review_locales`).
- Task: `hold_kind`, `on_hold_exceeded`, formal `inputs` and `outputs`, `text.brief` and `text.detailed`.
- Method: `text` (optional override), `max_batch_g`, `quality`, `passive_unattended`; requirement `phases`.
- Ingredient: `validation.kcal_check` exemption, `shopping.skip` and `section: none`, `source.dataset: example_placeholder` (rejected in `data/`).
- New operation `unload`.
- Text placeholder grammar (`{qty:...}`, `{temp_c:N}`, `{len_cm:N}`), rendered by cook mode, the session builder and the shopping list.

**Scheduler spec**
- **Slack applies only to `safety` and `quality` holds.** `continuity` holds are never tightened.
- Expansion removes methods whose `max_batch_g` is below the task's resolved input mass.
- `continuity` holds (5 minutes or less) are a documented approximation of vessel identity, and explicit vessel linking is a post-MVP option.

## 20. Open items

- Explicit vessel linking in the scheduler (post-MVP).
- Real USDA seeding: a script that pulls the reviewed records into `data/ingredients/`, plus the review workflow for each ingredient.
- A timing-log template (spreadsheet or app) for the cook-twice protocol.
- Yield overrides per recipe (a recipe-specific cooked yield for an ingredient).
- Sub-recipes (a shared sauce or base used by several recipes), out of the MVP.
