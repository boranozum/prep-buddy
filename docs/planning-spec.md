# Prep Buddy: Planning Layer Specification

Status: DRAFT v0.1 (for review). Lives at `docs/planning-spec.md`.
Depends on: `docs/PRD.md`, `docs/data-model.md`, `docs/scheduler-spec.md`.
Implemented in: `packages/core` (pure TypeScript, no I/O, fully unit-tested). The mobile app calls it; the solver service never does.

The planning layer covers everything between "who is this user" and "the problem handed to the scheduler": targets, safety rails, filtering, portioning, the session builder, the shopping list and tracking.

---

## 1. Principles

1. **Pure and deterministic.** Every function here takes data in and returns data out. No network, no clock (time is a parameter), no randomness.
2. **Safety rails cannot be bypassed.** Calorie targets exist only as the output of one function (`applyRails`), and every code path that produces, imports or edits a target goes through it.
3. **Allergens are enforced at three gates** (library filter, session builder, pre-solve gate), so one bug can't put an allergen in front of a user.
4. **Macros come from raw ingredient weights and the canonical table.** Cooked weights are only for portioning and labels.
5. **Nothing is estimated silently.** When a target can't be reached or a value is approximate, the UI says so with numbers.
6. **Neutral tone.** The tracking UI never shames, and it never celebrates extremes (see 3.8).

## 2. Targets

### 2.1 Inputs
From the UserProfile: `sex_for_calculation` (`male`, `female`, or `unspecified`), age (from `birth_year`), `height_cm`, `weight_kg`, optional `body_fat_pct`, `activity_level`, `goal`, and optional `target_weight_kg`. `sex_for_calculation` is a formula input, not an identity field. `unspecified` uses the midpoint constant and the stricter floor.

### 2.2 BMR
- **Mifflin-St Jeor** (default): `BMR = 10*kg + 6.25*cm - 5*age + c`, with `c = +5` (male), `-161` (female), `-78` (unspecified, the midpoint).
- **Katch-McArdle** (if body fat is given): `BMR = 370 + 21.6 * LBM`, where `LBM = kg * (1 - bf/100)`.

### 2.3 TDEE
`TDEE = BMR * activity_factor`. Factors: sedentary 1.2, light 1.375, moderate 1.55, active 1.725, very active 1.9. The activity level describes life outside cooking sessions. All values are estimates with roughly +/-10% error, and the UI says so.

### 2.4 Goal to daily energy
- Rate presets for losing: **gentle 0.25%**, **steady 0.5% (default)**, **faster 0.75%** of body weight per week. A custom rate is accepted up to the cap in R4.
- Gaining: presets 0.25% and 0.5% per week (the cap).
- `daily_delta_kcal = rate_kg_per_week * 7700 / 7` (a rough rule of thumb; real change is smaller over time, which is why the trend adjustment in section 8 exists).
- `raw_target = TDEE - delta` (losing) or `TDEE + delta` (gaining), and `TDEE` for maintenance.

### 2.5 Macros
Computed after the rails have fixed the calorie target.
- **Protein:** `g_per_kg * reference_weight`. Defaults: 1.8 g/kg when losing or gaining, 1.6 when maintaining. User-adjustable within 1.2-2.4 g/kg, and never more than 40% of target kcal. `reference_weight` is the actual weight, except for BMI >= 30, where it is the adjusted weight: `ideal + 0.25 * (actual - ideal)`, with `ideal` the weight at BMI 25.
- **Fat:** 25% of target kcal, floor `max(20% of kcal, 0.5 g/kg)`.
- **Carbs:** the remainder. Floor 50 g/day. If the remainder falls below the floor, reduce fat toward its floor, then protein toward 1.4 g/kg. If it is still infeasible, return an error state ("target can't be split into macros, review your inputs") instead of a bad plan.
- **Energy conversion:** 4 kcal/g protein and carbohydrate, 9 kcal/g fat.
- Optional fiber guidance: about 14 g per 1000 kcal (informational only).

All numeric defaults in this section are hypotheses for a qualified dietitian to review before launch.

### 2.6 Meals and slots
The user sets `meals_per_day` (2-6, default 3) and per-slot shares of the daily target (default equal split, editable, must sum to 100%). A session covers `days` (1-7) x meal slots, and per-slot targets drive portion scaling.

## 3. Safety rails

`applyRails(profile) -> { targets, adjustments[], blocks[] }` is the only producer of calorie and macro targets. It returns what it changed and why, so the UI can explain it.

| ID | Rule | Behavior |
|---|---|---|
| R1 | Adults only | `birth_year` implies age < 18: no targets and no profile with body stats. Onboarding ends with a plain message that the app is for adults. |
| R2 | Calorie floor | Weight-loss targets never below 1,200 kcal/day (female), 1,500 (male or unspecified). |
| R3 | Deficit cap | Target never below 75% of TDEE (deficit at most 25%). |
| R4 | Rate cap | Loss rate at most 1% of body weight per week, gain at most 0.5%. Presets stay below the cap. |
| R5 | Underweight guard | BMI < 18.5: no weight-loss target; maintenance or gain only. Re-evaluated on every weight change, so crossing 18.5 downward switches the goal to maintenance with a message. |
| R6 | Health gate | Onboarding asks whether the user is pregnant, breastfeeding, or has a medical condition affecting their diet. **Yes** disables computed targets and deficits and shows a message recommending a doctor or dietitian. The rest of the app stays available in **manual target mode** (the user types daily kcal and macros, accepted between the R2 floor and 5,000 kcal) or in **no-targets mode** (3.9). The answer is stored on the device only. |
| R7 | Input plausibility | Height 120-230 cm, weight 30-300 kg, age 18-100, body fat 3-60%. Outside these ranges is a validation error, not a clamp. |
| R8 | Import re-validation | Importing an export file re-runs `applyRails`. Unsafe stored targets are recomputed or rejected, never trusted. |
| R9 | Trend guard | Trend-based suggestions (section 8) pass through the rails and never propose a larger deficit if the observed loss rate already meets the R4 cap. |
| R10 | Copy | "Not medical advice" and health-gate texts are human-reviewed in both locales. |

**Order of application** for a loss goal: `target = max(raw_target, floor(R2), 0.75 * TDEE(R3))`. If the result is not below TDEE (for example a tiny TDEE that is already at the floor), **no deficit is possible**: offer maintenance and say why. If any rail changed the target, the UI shows the requested rate, the effective rate, and the reason in plain numbers ("you asked for 0.75%/week; this target is about 0.4%/week").

### 3.8 Tone guard (design constraints, reviewed in copy review)
- No "over budget" or red warnings for exceeding a target, and no shame or guilt language.
- No streaks, no weigh-in pressure (weigh-ins are opt-in), no "calories burned" goals.
- Never celebrate extreme rates or rapid weight loss.
- Numbers are shown neutrally ("about 320 kcal left today"), and both under- and over-target days use the same calm wording.

### 3.9 No-targets mode

`UserProfile.targets_mode` is `computed`, `manual` or `none`.

- **Who gets it:** any adult who chooses it at onboarding (switchable later in settings), and it is offered alongside manual mode in the R6 health-gate case. Under-18 users are still blocked entirely (R1).
- **Onboarding in `none` mode** skips body stats, goal and activity level. It still asks for language and units, allergies, diet, equipment and experience level.
- **Hidden in this mode:** every calorie and macro figure, the macro-fit panel, weight entries and trend, daily and weekly totals.
- **Kept:** the recipe library and all three allergen gates, session building, scheduling, the shopping list, cook mode, containers (with use-by dates) and marking containers as eaten (for inventory only, with no totals).
- **Portioning:** recipes use their base portion (`f = 1`), the user only picks the number of servings, and auto-scale is unavailable. The wrap-up still shows cooked component weights, so containers come out even.
- **Switching modes:** moving to `computed` or `manual` runs the relevant onboarding steps and `applyRails`. Moving to `none` offers to **delete stored body and weight data**.
- The tone guard (3.8) applies unchanged.

## 4. Constraints and library filtering

### 4.1 Hard constraints
- **Allergens:** a recipe is hidden if `recipe.allergens` intersects the user's allergens. Recipe allergens are **derived** from ingredients (data model), so they can't drift from the ingredient data. The allergen set is the EU/US superset, and ambiguous means included.
- **Diet rules:** defined in `schemas/diet-rules.json`, mapping each rule to the `diet_flags` it excludes.
  - `vegetarian`: excludes `contains_meat`, `contains_fish`, `contains_gelatin`
  - `vegan`: excludes those plus `contains_animal_product`
  - `pescatarian`: excludes `contains_meat`
  - `no_pork_alcohol`: excludes `contains_pork`, `contains_alcohol`
- **Equipment:** every task's baseline method must be satisfiable by the user's kit (scheduler and data model specs).
- Allergen and diet data cover **ingredients only**. Cross-contact ("may contain traces") is not modeled, and the UI copy says so.
- No ingredient substitution in the MVP, so users cannot swap in an allergen.

### 4.2 Three allergen gates
1. **Library filter:** the user only ever sees compliant recipes.
2. **Session builder:** re-checks on every add, and again on any profile change (a newly declared allergen removes affected recipes from an open session, with a message).
3. **Pre-solve gate:** `assertSafeForProfile(recipes, profile)` runs immediately before a Problem is built. Failure aborts, logs a local event, and shows an error. This gate must remain even if it looks redundant.

### 4.3 Soft constraints
Dislikes (ingredient IDs or categories) do not hide recipes. They add a "contains X" badge and lower the default sort position. A setting lets the user hide disliked recipes.

### 4.4 Browsing
Sort options: default (dislike-aware), protein per kcal, estimated active time, total time. No personalized recommendation engine in the MVP.

## 5. Portion scaling

### 5.1 Model
A recipe has `base_servings` and base ingredient grams (data model 3.2). In a session, each selected recipe has:
- `servings`: the number of portions (containers) to make.
- `portion_factor` `f` within `[min_factor, max_factor]`: how large each portion is relative to the base portion.
- Optional per-ingredient factors for `flex` ingredients, each within its own bounds.

Total raw grams for ingredient `i` = `servings * (base_grams_i / base_servings) * f_i`, where `f_i = f` for non-flex ingredients.

### 5.2 Fitting to a target
Goal: per-portion macros close to the per-slot target. Deterministic and small:
1. If there are no flex ingredients, choose `f` to hit the per-slot kcal, clamped to bounds (kcal is linear in `f`).
2. Otherwise solve a small **bounded least-squares problem** over `f` and the flex factors, minimizing weighted deviation from the per-slot protein, kcal and carb/fat targets (protein weighted highest), within bounds.
3. Round grams to each ingredient's `portion_step_g` (default 5 g; countable items to whole units) and **recompute macros from the rounded weights**, so displayed macros always equal what will be weighed.
4. Report achieved vs. target per macro and which bound is binding ("rice is at its maximum portion").

If a recipe can't come within tolerance (kcal +/-10%, protein +/-15%) the UI says so plainly and shows the closest reachable values.

### 5.3 Raw vs. cooked
- **Nutrition is always computed from raw weights.**
- For the wrap-up, cooked weights come from `yield.mass_factor`: the target cooked weight of a component per container = `(total raw grams of the component / servings) * mass_factor`. Components are ingredients, or groups sharing a `portion_group`. Ingredients without a yield (oil, seasonings) are part of the mix and not weighed separately.
- **Weigh the batch.** Yields vary, so the wrap-up lets the user enter the actual total cooked weight of a component. The per-container weight then becomes `actual_total / servings`, keeping per-container macros accurate regardless of how much water was absorbed.

## 6. Session builder

**Session settings:** `days` (1-7), meal slots, slot shares. **Limits:** at most 6 recipes and about 100 task instances per session, so solver time stays bounded.

**Live macro fit** (recomputed as the user edits):
- Per-day average kcal, protein, carbs and fat across the session, compared with daily targets.
- Slot coverage: portions vs. slots ("12 of 15 meals covered").
- Status per macro: within +/-5% is on target. Otherwise a neutral shortfall or surplus message with numbers ("protein averages 25 g/day below target"). Message strings are UI keys with numeric parameters.
- **Auto-scale portions** button: the fit in 5.2 extended across recipes as a bounded least-squares over each recipe's `f` and flex factors.

**Prep-time preview.** As recipes are added (debounced), run expansion, batching and the **on-device greedy scheduler** and show an estimate. The solver's plan is never worse than greedy (scheduler spec, P4), so the label is an **upper bound**: "up to 2 h 10 min". The real plan comes from the solver when the user taps Build. The estimate works offline. Building a plan requires a connection (scheduler spec, section 3).

## 7. Shopping list

**Inputs:** the session's resolved quantities (after rounding), the user's pantry, and the units setting.

1. **Aggregate** by canonical ingredient ID, summing grams across recipes.
2. **Purchase quantity.** Recipe grams are as-used weights. Divide by the ingredient's `edible_fraction` (for example 0.85 for onions with peel and ends) to get what to buy. Countable items use `unit_weights` and round **up** to whole units ("3 onions").
3. **Pantry subtraction.** A pantry entry with grams reduces the need. An entry without an amount means "have plenty" and removes the line.
4. **Staples** (`shopping.staple`: oil, salt, spices) are not listed as items. They appear in a "Check your pantry" checklist with the quantity needed, and the user can mark them as always on hand.
5. **Pack sizes.** Pick the combination of the ingredient's `pack_sizes_g` that covers the need with minimum overage. Each line shows **need** and **buy** ("need 730 g, buy 1 kg pack"). Ingredients without pack sizes show the exact need.
6. **Group by store section:** produce, meat and fish, dairy and eggs, dry goods, canned, frozen, bakery, other. Section names are UI strings.
7. **Display units:** metric (g, kg, ml, l) or imperial (oz, lb; 1 oz = 28.3495 g, 1 lb = 453.592 g). Display rounding is presentation only and **never feeds back** into calculations.
8. Ingredient names use the UI language, and sorting uses locale-aware collation.
9. Checked state is stored locally, and the list works offline.

## 8. Tracking

### 8.1 Containers
At wrap-up each portion becomes a **container**: recipe, cooked date, storage (fridge or freezer), `use_by`, macros (from the raw ingredients allocated to it), and a printable label with the localized name and macros. `use_by` comes from the recipe's conservative `storage` values. A **containers** view lists what's in the fridge and freezer with `use_by` dates, in neutral language.

### 8.2 Log entries
- **Plan entry:** one tap on a container ("ate this"). Optional `fraction` (for example half a portion, default 1). Macros scale by the fraction.
- **Other entry:** calories required, protein/carbs/fat optional, optional note. No food database in the MVP.
- Entries store the timestamp and the **local date** at the time (device time zone), so day boundaries stay correct if the user travels.
- Edit and delete are supported for all entries.

### 8.3 Totals
Daily totals sum entries for the local date. When "other" entries lack macros, totals for those macros are shown as "at least X" instead of a wrong exact number. A weekly view shows averages against targets, following the tone guard.

## 9. Target adjustment from weight trend

Optional and opt-in. Weigh-ins (`date`, `kg`) are stored locally.

- **Trend:** exponentially weighted moving average of weigh-ins (smoothing factor about 0.1) to absorb daily noise.
- **Observed rate:** linear fit over the last 3-4 weeks of trend. Requires at least 14 days of data with at least 5 weigh-ins.
- **Suggestion condition:** observed and expected rate differ by more than 0.25 kg/week for 3 consecutive weeks.
- **Proposed change:** `delta_kcal = (observed - expected) * 7700 / 7`, clamped to +/-150 kcal per step, then passed through `applyRails` (R9).
- **Never automatic.** The app suggests and the user confirms. At most one suggestion per 3 weeks. Declining suppresses the same-direction suggestion for 3 weeks.
- When the user reaches an optional `target_weight_kg`, the app suggests switching to maintenance.
- All thresholds are hypotheses to be tuned.

## 10. Schema follow-ups required by this spec

Already folded into `docs/data-model.md` v0.2 (listed here for traceability):
- `Ingredient.edible_fraction` (0-1, default 1) and `Ingredient.portion_step_g` (default 5).
- `Recipe.ingredients[].portion_group` (optional).
- `UserProfile`: `targets_mode` (`computed`, `manual`, `none`), `target_weight_kg?`, `meals_per_day`, `slot_shares[]`, `health_gate` (sensitive, device-only), `hide_disliked: bool`.
- `LogEntry.fraction` (default 1) and `LogEntry.local_date`.
- New entity `WeightEntry { id, date, kg }`.
- New file `schemas/diet-rules.json`.
- `sex_for_calculation` enum gains `unspecified`.

## 11. Test strategy

| ID | Test |
|---|---|
| T1 | **Rails, table-driven and property-based:** for any valid input, a weight-loss target is never below the floor or 75% of TDEE, and loss rate never exceeds 1%/week. Underweight, minor and health-gate profiles never receive a deficit. |
| T2 | **Allergen gates, generative:** for randomly generated profiles and library subsets, no recipe intersecting the user's allergens is visible at any of the three gates. |
| T3 | **Derived tags:** every recipe's allergens equal the union of its ingredients' allergens (build test), and an ingredient with missing allergen data fails the build. |
| T4 | **Formulas:** golden tests for BMR, TDEE and macro splits against hand-computed values, including edge cases (tiny TDEE, BMI >= 30, carb-floor squeeze). |
| T5 | **Scaling bounds:** fitted factors always lie within declared bounds, and displayed macros equal macros recomputed from rounded weights. |
| T6 | **Macro conservation:** the sum of container macros equals the session's macros (within rounding). |
| T7 | **Shopping list:** total buy grams >= need minus pantry for every ingredient, no ingredient dropped, staples never appear as items. |
| T8 | **Import:** an export file with unsafe targets is corrected or rejected (R8). |
| T9 | **Units:** metric to imperial to metric round trips stay within 0.5%. |
| T10 | **Localization:** search is case-insensitive under Turkish rules, and a query like `IRMIK` matches `ırmık` in either UI language. |
| T11 | **Tone guard:** lint the UI string catalogs for banned terms and patterns (both locales), plus manual copy review. |
| T12 | **No-targets mode:** UI tests assert that no calorie or macro string is rendered in `none` mode, and that portion factors stay pinned at 1. Switching to `computed` always runs `applyRails`. |

## 12. Open items

- **Dietitian review** of every number in sections 2 and 3 before public launch.
- **Legal and privacy review:** body, health-gate and weight data is sensitive personal data. Local-first storage limits exposure, but requirements (for example GDPR in the EU, KVKK in Turkey) should be checked before release.
- Cross-contact and "may contain" information is out of scope.
- Micronutrients and fiber tracking beyond the informational fiber guide.
- Supplements, alcohol logging, and intermittent-fasting schedules.
