# Prep Buddy: Scheduler Specification

Status: DRAFT v0.1 (for review). Lives at `docs/scheduler-spec.md`.
Depends on: `docs/PRD.md`, `docs/data-model.md`.
Implemented in: `packages/core` (TypeScript: expansion, batching, greedy, verifier, repair, estimator) and `services/solver` (Python: CP-SAT model, verifier).

---

## 1. Goals and non-goals

**Goal:** given the recipes and portions a user picked, their kitchen and their experience level, produce one valid, efficient cooking session plan: what to do when, with which method, in which order, so that several recipes are cooked in parallel with the fewest hands-on minutes and the least waiting.

**Non-goals (MVP):** offline plan generation, multiple cooks, multiple ovens, dish-washing or counter-space modeling, size-aware pot assignment beyond simple pools (see 5.5), server-side re-solve during cooking, learning per-operation speeds.

**Non-negotiables**
- The plan comes from an algorithm, never an LLM.
- **Every** plan (solver, greedy, repair) passes the independent verifier before it is shown. A plan that fails verification is never displayed.
- Cook mode never needs the network.

## 2. Glossary

| Term | Meaning |
|---|---|
| Task instance | A recipe task with quantities resolved for the chosen servings, or a merged batch of such tasks. |
| Phase | Each task has an **active phase** (user's hands are busy) then an optional **passive phase** (food cooks or rests by itself). |
| End of a task | End of its passive phase, or of its active phase if it has none. |
| Hold limit | `hold_max_s`: the longest a task's output may wait between the task ending and a dependent starting. |
| In flight | A task counted toward the concurrency cap (see 5.6). |
| Problem | The fully resolved scheduling input (section 4). |
| Plan | A schedule for a problem: method choice and start times per task instance. |
| Makespan | Time from session start to the end of the last task, including wrap-up tasks. |

## 3. Pipeline

```
recipes + servings + profile
        |
 [1] Expand    (client)  -> tasks with resolved durations, kit, params   = Problem
        |
 [2] Batch     (client)  -> Problem with merged task groups
        |
 [3] Solve     (server, CP-SAT)  ---- service error / timeout ---->  [4b] Greedy (client)
        |                                                          |
 [4] Verify    (server, then client again)  <------------------------
        |  fail -> unmerge offending batch and retry (bounded), else fall back
        v
   SessionPlan (stored, cached for offline cook mode)
```

- Stages 1, 2, 4b and the client-side verify run in `packages/core`. Stage 3 and the server-side verify run in `services/solver`.
- **The client always re-verifies** a server plan, regardless of the server's own check.
- **Creating a new plan requires an internet connection** (product decision). Offline, the app can't build a session and says so plainly; existing cached plans, the shopping list and cook mode still work. If the user is online but the solver service fails or times out, the app falls back to the greedy scheduler and labels the result ("estimated time may be longer"), because blocking users during an outage is worse than a slightly slower plan.

## 4. Stage 1: Expansion (client)

Expansion turns recipes plus profile into a **Problem** (`schemas/scheduling-problem.schema.json`, new schema).

**Quantities.** Recipe quantities are scaled by the chosen servings and portion factor (data model 3.2), within the recipe's scaling limits.

**Durations, per method:**
- `active_s = round(60 * multiplier * (fixed_min + per_unit_min * quantity))`
- `passive_s = round(60 * (fixed_min + per_unit_min * quantity))`, or `fixed` if `scales: false`. **The multiplier never applies to passive time.**
- `multiplier` comes from the user's experience settings. Because expansion runs on the client, **the solver receives final numbers and never sees the multiplier**.

**Hold limits and slack.** For holds of kind `safety` and `quality`, `hold_max_s` is tightened by the experience level's `slack_s`: `effective_hold_max_s = max(0, hold_max_s - slack_s)`. `continuity` holds (5 minutes or less, approximating staying in the same vessel) are **never** tightened. This keeps a buffer, so a slow onion doesn't cascade into a sauce that sat too long. If tightening makes a problem infeasible, expansion retries once with `slack_s = 0` and flags the plan as "tight".

**Equipment filtering.** Methods whose requirements the user's kit can't satisfy, or whose `max_batch_g` is below the task's resolved input mass, are removed. If a task has no remaining method, the recipe should not have been selectable, and expansion fails loudly (this is a bug, not a user error).

**Problem shape:**

```yaml
schema_version: 1
tasks:
  - id: t_017
    ref: { recipe_id: chicken_rice_bowl, task_id: cook_rice }   # or batch_ref for merged tasks
    needs: [t_009]
    hold_max_s: 1200            # effective, already tightened; null if none
    methods:
      - id: stovetop
        active_s: 180
        passive_s: 1080
        passive_unattended: false
        requires:
          - { capability: heat_source, count: 1, phases: [active, passive] }
        oven: null              # or { temp_c: 200, tolerance_c: 15, trays: 1, preheat_s: 600 }
kit:
  heat_source: 3
  oven: { trays: 2 }            # absent if no oven
  pots: [ { liters: 3 }, { liters: 5 } ]
  appliances: [rice_cooker]
params: { concurrency_cap: 3, time_limit_s: 10, seed: 1 }
```

No user identifiers, body data or allergen data appear anywhere in a Problem.

## 5. Stage 2 and 3: Batching and the solver model

### 5.1 Batching (deterministic)

Tasks with the same `batch_key` may be merged into one task group.

**A merge is allowed only if:**
1. The members have no dependency path between them.
2. They share at least one method ID with equal requirements. The merged task's methods are the intersection.
3. The merged quantity fits any `max_batch_g` declared on the method (schema follow-up, section 11).

**Merged durations:** fixed time is counted **once**, per-unit time is summed over the merged quantity. Merged tasks keep all their members' dependents and hold limits.

**Undo rule.** After solving, if the plan is infeasible or the verifier reports a hold violation attributable to a merged group (for example onions diced too early), that group is split into its members and the problem is re-solved. Retry up to 3 rounds, splitting the offending groups only.

### 5.2 Model (solver-neutral)

Times are integer seconds. Horizon is the greedy plan's makespan (an upper bound), or the sum of all durations if greedy fails.

**Variables.** For each task `i` and method `m`: presence literal `p[i,m]` (exactly one is true), and start `s[i]`. Given the chosen method: active interval `[s, s+a)` and passive interval `[s+a, s+a+d)`.

**Constraints.**
1. **Hands.** No two active intervals overlap (one cook).
2. **Precedence.** For each `j` in `needs[i]`: `s[i] >= end[j]`.
3. **Hold limits.** `s[i] - end[j] <= hold_max_s[j]` where `j` is the predecessor with the limit.
4. **Burners.** Cumulative over intervals that require `heat_source`, capacity = number of burners. Each requirement occupies the phases it lists (default: both).
5. **Other capabilities and pots.** Cumulative per pool (see 5.5).
6. **Oven**, see 5.3.
7. **Concurrency cap**, see 5.6.
8. **Method availability.** Only methods present in the Problem (already filtered by the kit).

### 5.3 Oven model

Assumption: at most one oven.
- **Compatibility.** An oven task runs within `[temp - tolerance, temp + tolerance]`. Two oven tasks may overlap in time only if their ranges intersect. On a line, pairwise intersecting ranges always share a common point, so **pairwise constraints are sufficient**: for every incompatible pair, add a no-overlap constraint.
- **Trays.** Cumulative over oven tasks by tray count, capacity = the user's trays.
- **Preheat.** Each oven task has a preheat interval of `preheat_s` (default 600) immediately before its start. Preheat occupies the oven for the compatibility rule but not trays and not the user's hands. Compatible tasks may share preheat time by overlapping. The first oven task therefore can't start before `preheat_s`.
- The user only sees "preheat oven to X" once per compatible group in cook mode. That is presentation, derived from the plan.

### 5.4 Objective (lexicographic)

1. **Minimize makespan.**
2. **Minimize total active seconds.** This is the hands-on effort. It makes accelerators like a rice cooker or food processor win even when the wall-clock time ties. With methods fixed, idle time is determined by makespan and active time, so it is covered by objectives 1 and 2.
3. **Minimize context switches** (consecutive active items belonging to different recipes).
4. **Tie-break:** prefer finishing hold-limited items closer to when they're consumed.

Implementation may use staged solves (minimize makespan, then fix it within a small tolerance such as 2% and minimize the next objective) or dominating weights. Either way the ordering must be lexicographic.

### 5.5 Resource pools and known limitations

- Burners are a simple count. Pots and pans are counted per required minimum size: a requirement `{pot, min_liters: 3}` uses the pool of the user's pots with `liters >= 3`. Overlapping pools can double-count, and the verifier checks conservatively (it rejects if any valid assignment can't be shown).
- Not modeled: dish washing, counter space, the cook's movements, multiple cooks.

### 5.6 Concurrency cap

A task is **in flight** while it is in its active phase, or in its passive phase unless the chosen method declares `passive_unattended: true` (oven roasting, slow cooker, rice cooker, resting, cooling). At any time, in-flight count `<=` `concurrency_cap`. Effect: a beginner (cap 2) is doing one thing and watching at most one other, an experienced cook (cap 4) can juggle more.

### 5.7 Solver run parameters

- Default time limit 10 s for up to about 100 task instances. Return the best feasible solution found, with status `optimal` or `feasible`.
- Seeded, but solves are **not bit-for-bit reproducible** with a time limit. Plans are stored, so this is acceptable. Tests assert properties (section 10).
- **Warm start.** The greedy plan is provided as a hint, and the returned plan is never worse than the greedy plan on makespan.

## 6. Solver service contract (`services/solver`)

- `POST /v1/solve`, stateless. Request: a Problem. Response:

```yaml
status: optimal | feasible | infeasible | timeout_no_solution | invalid_request
plan: { items: [...], totals: {...}, provenance: {...} }   # absent if infeasible
infeasibility: { reason_code: hold_conflict | no_method | capacity | unknown, item_ids: [] }  # best effort
verification: { verifier_version, passed, violations: [] }   # server-side verify of its own output
```

- The service **verifies its own output** and returns `internal_error` instead of a plan that fails.
- No persistence, no logging of Problem contents beyond aggregate metrics.
- Abuse protection (rate limits and client attestation, since there are no accounts) is an open item for the implementation plan.

## 7. Verifier

**Independence rule:** the verifier takes only `(Problem, Plan)` and shares no code with the solver or greedy scheduler. It is deliberately simple, with no optimization. Two implementations exist (TypeScript in `packages/core`, Python in `services/solver`) and must agree on every case in the conformance suite.

| Code | Rule |
|---|---|
| V001 | Plan and Problem are structurally valid and versions match |
| V002 | Every task is scheduled exactly once with exactly one method from its allowed set |
| V003 | Durations equal the chosen method's resolved `active_s` and `passive_s` |
| V004 | Precedence: every task starts at or after all its predecessors end |
| V005 | Hold limits respected (effective values from the Problem) |
| V006 | Active phases never overlap |
| V007 | Burner and other capability pools never exceed capacity at any instant |
| V008 | Oven temperature compatibility for all overlapping oven tasks (including preheat intervals) |
| V009 | Oven tray capacity never exceeded |
| V010 | Preheat present and not overlapping incompatible oven use |
| V011 | Every chosen method's requirements are satisfiable by the kit |
| V012 | Concurrency cap respected at every instant |
| V013 | All times are non-negative integers |
| V014 | Merged groups: capacity respected, members consistent |
| V015 | Totals in the plan match the items |

Output: `{ passed, violations: [{ code, item_ids, detail }] }`. Violation `detail` is data, and user-facing text is never generated from it.

**Conformance suite** (`schemas/conformance/`): JSON cases `{ problem, plan, expected: { passed, codes[] } }`. Minimum: one valid case and at least one invalid case per rule, edge cases at exact boundaries (a hold limit met to the second, capacity exactly reached), plus small randomly generated cases with expectations computed from a reference brute-force checker. **Both implementations must pass all cases in CI**, and adding a rule requires adding cases.

## 8. Greedy scheduler (`packages/core`)

Purposes: service-outage fallback, warm start, benchmark, test oracle, and the engine for repair step 2.

**Method choice.** For each task, pick the available method with the least active time, ties broken by the least total time, then by method ID.

**List scheduling.** Repeat: from the ready set (all predecessors ended), choose by priority, place at the earliest time where hands, resources, oven rules and the concurrency cap allow.

**Priority (highest first):**
1. Longest remaining path to the end of the session (critical path, including passive time).
2. Tasks that unlock large passive windows (longer passive first, so waiting overlaps other work).
3. Members of the same batch group, and same-recipe continuity, to limit context switches.
4. Stable tie-break on task ID.

**Just-in-time release.** A task whose successor has a hold limit is not started until every other predecessor of that successor is already scheduled (or can finish in time), preventing the "diced too early" failure.

**Requirements:** deterministic (same Problem gives the same Plan, byte for byte), and its output is passed through the verifier. If it cannot produce a valid plan it returns a failure with a reason, and does not emit an invalid plan.

## 9. Live repair: the "I'm behind" flow (on device)

**Inputs:** the current plan, the current time `now`, and each item's state: `done`, `in_progress` (with its actual start and remaining time), or `not_started`. The user may optionally tell the app how long the current step will take.

**Steps (in order, stop at the first success):**
1. **Freeze** done and in-progress items in place.
2. **Shift only.** Keep the original order. Recompute start times for not-started items with one forward pass: each starts at the later of its original start and the earliest time its predecessors and resources allow. Verify. If it passes, use it.
3. **Greedy re-schedule.** Run the greedy scheduler on the not-started items, with frozen items as pinned occupancy in the resource calendars. Verify. If it passes, use it and show the user a **summary of what changed** (items that moved or were reordered).
4. **Safe fallback.** If neither yields a valid plan (for example a hold limit has already been exceeded), tell the user plainly and offer:
   - The item's authored **`on_hold_exceeded` action** (for example "refrigerate now, continue with the rest"), which is conservative and food-safety reviewed (schema follow-up, section 11). This action exists for `safety` holds. For a `quality` hold the app shows a gentle "may be past its best" note, and for a `continuity` hold it just prompts the user to take the pot off the heat.
   - **Drop a recipe:** remove a not-started recipe (and its unstarted tasks) from the session, then repair again. Recipes with started tasks can't be dropped, but their remaining steps can be shortened by the fallback action.

**Requirements:** deterministic, completes in under about 200 ms for up to 100 tasks on a mid-range phone (to be measured), never emits an unverified plan, and logs a `local_repair_applied` event with which step succeeded.

**Trigger.** The button is always manual. The app may also **suggest** pressing it when actual progress lags the plan beyond a threshold.

## 10. Speed-adjustment estimator and experience parameters

### 10.1 Starting values (hypotheses, to be tuned with session data)

| Level | Active multiplier | Concurrency cap | Slack (`slack_s`) |
|---|---|---|---|
| Beginner | 1.5 | 2 | 180 |
| Comfortable (reference cook) | 1.0 | 3 | 60 |
| Experienced | 0.8 | 4 | 0 |

Recipes are authored for the reference cook (multiplier 1.0).

### 10.2 Estimator (post-session, suggestion only)

- **Qualifying items:** `sole_focus = true`, `paused_s = 0`, active duration at least 30 s, and not a merged batch group. A session needs at least 5 qualifying items, otherwise it contributes nothing.
- **Per-session ratio:** median of `actual_active / planned_active` (planned already includes the multiplier). Session-level `actual_elapsed / planned_elapsed` is recorded as a secondary signal.
- **Trigger (asymmetric):**
  - **Slower than planned** (ratio `>= 1.10`) in **2** consecutive qualifying sessions: suggest slowing down.
  - **Faster than planned** (ratio `<= 0.85`) in **3** consecutive qualifying sessions: suggest speeding up. Speeding up needs more evidence because a plan that's too fast makes people fall behind.
- **Proposed change:** the median ratio of those sessions, clamped to a maximum step of **15% slower** or **10% faster**, and to an overall multiplier range of **[0.6, 2.0]**.
- **Never automatic.** The app asks; accepting updates `experience.speed_multiplier`. If the user declines, the same-direction suggestion is suppressed for the next 3 sessions.
- **Supporting signal:** two or more "I'm behind" presses in a session count as slower-than-planned evidence.
- Only active durations are affected. Passive times, hold limits and slack are untouched.

## 11. Schema follow-ups required by this spec

These additions are already folded into `docs/data-model.md` v0.2 (listed here for traceability):
- `Method.max_batch_g` (optional): capacity limit for merging (rice cooker size, tray area).
- `Requirement.phases` (`active` and/or `passive`, default both).
- `Method.passive_unattended` (bool, default false).
- `Task.on_hold_exceeded`: `{ action: refrigerate | keep_covered | discard_advice, text: I18nString }`, authored conservatively and reviewed for food safety in both locales.
- `Capability.oven.preheat_s` default (configurable, default 600).
- New schema `scheduling-problem.schema.json` (section 4), and SessionPlan items gaining `batch_ref`.
- Data model principle 7 to read: a solver request contains tasks with resolved durations, kit, concurrency cap and time limit (no multiplier, no personal data).
- `Task.hold_kind` (`safety` | `quality` | `continuity`), which controls slack tightening and exceeded-hold behavior. `docs/recipe-authoring-guide.md` section 19 lists all other schema additions that came out of authoring the example recipes.

## 12. Test strategy

Because solves aren't reproducible, tests assert **properties and bounds**, not exact plans.

| Property | Check |
|---|---|
| P1 Verifier gate | Every plan from the solver, greedy and repair passes the verifier |
| P2 Conformance | Both verifier implementations pass all conformance cases |
| P3 Equipment monotonicity | `makespan(solve(kit + X)) <= makespan(solve(kit))`. Use small instances solved to optimality; in production the warm start from the smaller-kit plan gives this by construction |
| P4 Never worse than greedy | Solver makespan `<=` greedy makespan on every benchmark |
| P5 Determinism | Greedy and repair are byte-identical across runs |
| P6 Batching | Merging never increases total active time; unmerge-on-failure terminates within 3 rounds |
| P7 Multiplier | Raising the multiplier never lowers the optimal makespan; passive durations and hold limits are unchanged by it |
| P8 Repair | Repair returns a verified plan or an explicit fallback, never an unverified plan |
| P9 Hold safety | No plan ever exceeds a hold limit (covered by V005 on every plan) |

**Benchmarks:** three recipe sets (2, 4 and 6 recipes) crossed with three kits (minimal stovetop, standard 4 burners plus oven, fully equipped) and three experience levels. Record makespan, active time, solver time, and greedy-vs-solver gap. Initial performance budgets (hypotheses): solver at most 10 s for 100 tasks, greedy at most 100 ms, verifier at most 50 ms, repair at most 200 ms on a mid-range phone.

**Golden cases:** three small hand-solved instances (in the repo) whose optimal makespans are known, to sanity-check the model.

## 13. Open items

- Exact numeric values in 10.1, thresholds in 10.2 and performance budgets in 12 are hypotheses, to be tuned with real session data.
- A more faithful oven model (oven state over time, cool-down when temperature drops) is out of the MVP.
- Abuse protection for the solver endpoint (rate limits and client attestation without accounts).
- Size-aware pot assignment.
