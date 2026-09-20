# Prep Buddy: Cook Mode Specification

Status: DRAFT v0.1 (for review). Lives at `docs/cook-mode-spec.md`.
Depends on: `docs/PRD.md`, `docs/data-model.md`, `docs/scheduler-spec.md`, `docs/planning-spec.md`.
Implemented in: `apps/mobile` (screens, notifications, persistence) on top of `packages/core` (repair, verifier, timing rules).

Cook mode is the product. It turns a verified session plan into a calm, step-by-step experience for someone standing at a counter with wet hands and a phone propped against the wall.

---

## 1. Principles

1. **One primary action per screen.** The current step, one big button. Everything else is secondary.
2. **Hands-messy design.** Large tap targets, bottom-anchored actions, no precision gestures, undo instead of confirm dialogs.
3. **State is derived from timestamps, never from running counters.** The app can be backgrounded, killed or rebooted and still show the truth.
4. **Persist every transition** before acting on it. Nothing the user did is lost.
5. **Offline.** A started session never needs the network.
6. **Only verified plans.** Cook mode never displays a plan (or a repaired plan) that hasn't passed the verifier.
7. **Neutral tone.** Being behind is normal. No red alarms for lateness, no shaming.
8. **Safety first.** Food-safety hold limits outrank convenience and are surfaced explicitly.

## 2. Session state machine

```
ready --> mise --> cooking --> wrapup --> done
              \        |  ^
               \       v  |
                \--> paused (overlay on cooking/mise)
any active state --> abandoned
```

| State | Meaning | Exits |
|---|---|---|
| `ready` | Plan cached, session not started | Start (goes to `mise`, or straight to `cooking` if mise is skipped) |
| `mise` | Mise en place checklist (section 3) | "Start cooking" |
| `cooking` | Executing plan items | All non-wrap-up items done goes to `wrapup` |
| `wrapup` | Portioning, containers, storage (section 8) | Finish goes to `done` |
| `done` | Summary shown, record finalized | none |
| `abandoned` | User ended early (with confirmation) | none; finished recipes may still produce containers |

`paused` is a flag, not a state: it stops **active-time measurement** only. Timers and the plan clock keep running, because food doesn't pause. On resume, if the user is more than 2 minutes behind plan, the app suggests the "I'm behind" flow.

**Persistence.** A `CookSession` record in SQLite holds: state, plan id and revision, `t0` (UTC start of cooking), per-item state, timers, events and the render bundle. It is written **before** each transition takes effect. On launch the app reads the record and reconciles (section 7). A property test kills the process at every transition and checks the resumed state.

**Item states:** `waiting` (predecessors not ended), `ready`, `active` (current card), `passive_running`, `done`, `skipped` (only for tasks marked optional), `dropped` (recipe dropped by the fallback flow).

**Plan time.** Item times in the plan are offsets from `t0`. Actual progress deviates, and the plan is a guide until a repair produces a new revision.

## 3. Mise en place

1. **Equipment.** "You'll need:" derived from the chosen methods: pots and pans, oven and temperature, appliances. Read-only checklist.
2. **Ingredients.** A checklist with localized names and amounts in the user's units. Default grouping is by first use in the plan, with an alternate "by recipe" view. Each line carries the recipe's badge (letter plus shape, never color alone). Tapping checks it off. The step cards always show amounts too, so mise is **recommended, not mandatory**: a "Skip, weigh as I go" button is provided.
3. **Time.** The prep-time estimate shown before starting includes mise. Estimate for mise is about 30 seconds per distinct ingredient (a hypothesis), measured separately from cooking time in the session record.
4. **System prompts.** "Preheat the oven to 200 C" and similar scheduler-derived actions (preheat, oven off) appear as **non-blocking banners** with a "Got it" tap. They take no plan time in the scheduler and don't affect timing data.

## 4. The cooking screen

**Top bar:** elapsed time, estimated time remaining, **I'm behind**, pause, overflow menu (full timeline, recipes, settings, end session).

**Primary card** (the current active item):
- Title from the task (for example "Dice the onions") and the recipe badge.
- Amounts in the user's units. For **merged batches** the card shows the total and the split by destination: "Dice 600 g onion: 200 g for chicken bowl (A), 400 g for soup (B)", with bowl labels matching the badges.
- Coaching text: `brief` or `detailed` per the user's experience level, with a per-step "more detail" toggle.
- The chosen method badge (for example "rice cooker").
- **One button: Done.** Full width, anchored at the bottom, at least 72 dp high. It is always visible, and the card content scrolls above it.

**"While you wait" lane:** running passive items with name, remaining time (mm:ss) and a progress bar. Tap for details. At most 4 rows visible, then "+N more". Below it: a dimmed **next up** preview of the next one or two items.

**Waiting card.** If the next item in plan order isn't ready (its passive predecessor is still running), the primary card becomes "Next: X, ready in 6:20". A **Skip ahead** button runs the repair engine in "pull forward" mode (scheduler spec section 9, step 3) and offers a ready item if a verified plan allows it. It never reorders unverified.

**Timeline view:** a read-only overview of the plan with the current position, reachable from the menu.

**Layout.** Portrait and landscape are both supported (the phone is often propped sideways). Content adapts, and the Done button stays full-width at the bottom either way.

## 5. Timing capture: one tap

The user taps **Done** at the end of each active step. The app infers everything else.

**Definitions**
- `shown_at`: when an item became the current card. That is the moment the previous active item was done, or, for an item that was waiting, `max(ready_at, first_view_at)`, where `first_view_at` is when the app was foregrounded with that card visible. This avoids counting time the user spent away from the phone.
- `done_at`: the Done tap.
- `actual_active_s = done_at - shown_at - paused_s`.
- **Passive phase:** starts automatically at `done_at` with an absolute end timestamp `done_at + passive_s`. Tasks with zero active time start when ready, with no tap.
- `sole_focus`: true iff, during `[shown_at, done_at]`, no other *attended* item was in flight (per the scheduler spec's concurrency definition) and no pause or interruption event occurred. It is derived from the timers table, not asked.
- `suspicious`: Done tapped within 2 seconds of `shown_at` on an item whose planned active time is 30 s or more, or a step undone and redone. Suspicious items are excluded from the speed estimator.

**Undo, not confirm.** After Done, a snackbar "Undo" stays for 10 seconds. Undo restores the previous state exactly and logs `undo_done`. There is no confirmation dialog.

**Passive completion** is recorded at the timer's end timestamp (`passive_end_at`), not at acknowledgement, so dependents become ready at the correct time. The acknowledgement time is stored separately.

**Retroactive Done.** "I already did this" marks the current item done at `now`, flagged `suspicious`.

**Data recorded** (into the SessionRecord, data model 3.9, plus the fields in section 11): `item_shown`, `item_done`, `undo_done`, `timer_started`, `timer_fired`, `timer_acknowledged`, `timer_extended`, `paused`, `resumed`, `behind_pressed`, `repair_applied` (which step), `repair_failed`, `hold_exceeded`, `skip_ahead`, `session_ended`, `pace_feedback`.

## 6. Timers and notifications

### 6.1 Timer model
`Timer { id, item_id, kind (passive | user | hold_warning), label_key, end_at (absolute UTC ms), created_at, state (running | fired | acknowledged | cancelled) }`.

- Remaining time is `end_at - now`. The 1-second UI tick only re-renders. **No countdown counters are ever stored or decremented.**
- Timers are created at runtime (when a passive phase starts), so only a handful of notifications are pending at once. This also keeps the app well below the OS cap on pending local notifications (iOS caps it at 64 as far as I know; verify).

### 6.2 What gets scheduled (at passive start, since code can't run while the app is asleep)
1. An **end notification** at `end_at`.
2. For a passive item whose dependent has a `safety` or `quality` hold limit: a **hold warning** at `end_at + effective_hold_max - 120 s`. It is cancelled when the dependent starts.
3. Optional user timers ("+2 min", custom) the same way.

### 6.3 When a timer fires
- **Foreground:** a full-screen alarm banner with sound and a repeating haptic until acknowledged. After 5 minutes the sound stops and a persistent banner remains. Simultaneous timers show as one list with a single sound.
- **Background or locked:** the scheduled local notification with sound. On iOS use the highest interruption level available so it can break through Focus (verify availability in the chosen Expo setup); on Android use a high-importance channel and exact alarms.
- **Actions on the notification:** open the app, and "+2 min". Extending a timer logs `timer_extended` and runs shift-only repair automatically. If no valid plan results, the "I'm behind" flow opens.

### 6.4 Platform reliability (all to be verified on real devices)
- **Android:** exact-alarm permission is required for on-time delivery (check the current Play policy for alarm and timer apps). Doze and vendor battery managers (some OEMs are aggressive) can delay or kill background work. Include a **first-session "Test alarm"** step: schedule a 10-second notification and ask the user to lock the phone. If it doesn't ring, show a one-time hint about battery settings.
- **iOS:** silent switch and Focus modes affect sound. The app requests permission at first use and explains why.
- **Permission denied:** a persistent banner ("Timers won't ring when your phone is locked"), plus keep-awake and in-app audio still work. Never block cooking.
- **Reboot:** scheduled notifications may not survive. On next launch, reconcile (section 7) and flag late timers.
- **Clock changes:** on foreground, compare the wall clock against elapsed monotonic time. If they disagree by more than 60 seconds, warn "your phone's clock changed, timers may be off" and offer to re-anchor. Don't silently adjust.

### 6.5 Wake lock and battery
Keep the screen awake during `mise`, `cooking` and `wrapup` (foreground only). Below 15% battery, show a gentle "consider plugging in" banner. An optional "dim when idle" setting lowers brightness after 60 s but stays awake. Post-MVP: lock-screen or ongoing-notification display of the next timer.

## 7. Returning to the app: reconciliation

`reconcile(now)` runs on every foreground and launch:
1. **Timers:** any `running` timer with `end_at <= now` becomes `fired`, recording `fired_late_s`. The item's passive end is `end_at`, so its dependents became ready then and may have been ready for minutes.
2. **Current card** is recomputed from item states, so a user who returns after 10 minutes sees the right step, with "ready for 4 min".
3. **Hold limits:** for each pair where `now > predecessor_end + hold_max` and the dependent hasn't started, mark `hold_exceeded`, log it, and show the item's authored **`on_hold_exceeded` action** immediately (for example "refrigerate it now"), because repair cannot fix a safety violation. This applies to `safety` holds. `quality` holds show a gentle "may be past its best" note, and `continuity` holds prompt the user to take the pot off the heat.
4. If the user was away more than 2 minutes, show a short "welcome back" summary of what finished and what's ready.
5. If lateness exceeds a threshold (default 3 minutes over plan), show the gentle "You're about N minutes behind. Adjust the plan?" prompt.

## 8. "I'm behind"

**Entry:** the top-bar button, or the gentle prompt from section 7. Always available.

**Flow**
1. **Sheet:** "How much longer will this step take?" with large chips (+2, +5, +10 min, or type a number, or "not sure"). "Not sure" assumes the remaining planned time scaled by the user's running ratio (capped at 2x).
2. **Repair** runs in `packages/core` (scheduler spec section 9): shift-only, then greedy re-schedule, each verified.
3. **Result sheet:** new estimated finish time versus old, a list of what moved (count and names), and **Apply** or **Cancel**. Cancel changes nothing.
4. **Fallback screen** (no valid plan): a plain explanation, the authored safe action for any hold-exceeded item, and **Drop a recipe** (only recipes with no started tasks). After dropping, repair runs again.

**On Apply:** a new plan **revision** (provenance `local_repair`) becomes current, and the old one is kept in the session record. Running passive timers are frozen and untouched. Future timers don't exist yet, so nothing needs rescheduling. The event is logged with the step that succeeded.

## 9. Wrap-up

Wrap-up items (cool, portion, store) are ordinary plan tasks with hold limits, so cooling deadlines get the same reminders. The interactive part:

1. **Weigh and portion, per recipe and component.** Shows the target cooked grams per container (planning spec 5.3). **Weigh the batch:** the user can enter the actual total cooked weight of a component, and the per-container target becomes `actual_total / servings`. A large numeric keypad and a units toggle are provided, and the step is skippable ("use estimates").
2. **Containers** are created (one per portion) with recipe, cooked date, storage choice, `use_by`, and macros (unless `targets_mode` is `none`).
3. **Label text** for each container (large, copyable, for writing on tape): localized name, cooked date, use-by date, and reheat note. Printing is post-MVP.
4. **Storage and reheating guidance** from the recipe's `storage` fields. Values are conservative and must be reviewed for food safety in both locales.
5. **Summary:**
   - Total session time, hands-on time, mise time, planned vs. actual, number of repairs. Neutral wording; a completed session is the achievement.
   - The **speed suggestion** if the estimator triggers (scheduler spec 10.2). It is non-blocking and can be declined.
   - **One-tap pace feedback:** "too fast / about right / too slow" (optional). It is stored with the session and used as a supporting signal.
   - Optional: "how long do you usually spend on prep like this?" asked once in onboarding as `baseline_session_min`, used to show the user's own before-and-after.

## 10. Accessibility and localization

- **Text scaling** up to 200% of the OS setting without breaking layout. The Done button is pinned and never scrolls out of view.
- **Contrast** at WCAG AA or better (4.5:1 body, 3:1 large), tested in bright light, plus a dark theme. **Color is never the only cue** (badges use a letter and shape).
- **Screen readers:** labels on every control. Timers announce at sensible intervals, not every second. Alarms have a vibration and a visual flash, not only sound.
- **Reach:** primary actions bottom-anchored and centered, so one-handed and left-handed use work equally.
- **Turkish:** strings can run considerably longer than English (plan for 30-40%), so no fixed-width buttons. Use a pseudo-locale in tests. Casing, plurals, number and time formats follow the locale, and 24-hour time follows the device.
- **Authoring rule for step titles:** at most about 6 words. Long explanations belong in the detailed text.
- **Voice** is deferred, but the state machine exposes named commands (`done`, `undo`, `repeat`, `pause`) so voice can be added without redesign.

## 11. Edge cases

| Case | Behavior |
|---|---|
| Incoming call or app backgrounded | State persists; timers keep running; reconcile on return |
| App killed or phone rebooted | Reconcile at launch; late timers flagged; notifications re-established for running timers |
| Notification permission denied | Persistent banner; in-app alarm and keep-awake still work |
| Multiple timers end together | One alarm surface listing all; one sound |
| Out-of-order tapping | Not allowed directly; use "Skip ahead" (verified) or "I already did this" |
| User ends session early | Confirm; mark abandoned; keep partial records; finished recipes may still get containers |
| Recipe content updated after plan creation | Ignored; the session uses its **render bundle** |
| Language switched mid-session | Supported: the render bundle contains both locales |
| Low battery or storage | Banner only; never blocks |

## 12. Schema follow-ups required by this spec

Already folded into `docs/data-model.md` v0.2 (listed here for traceability):
- **Render bundle** in the session plan: a denormalized snapshot of every recipe, ingredient name, step text (both locales) and storage text used by the plan, so cook mode is fully offline and immune to content updates.
- **Timer** entity (section 6.1) and **CookSession** entity (state, plan revisions, timers, events).
- `SessionRecord.item_records[]` gains `shown_at`, `first_view_at`, `suspicious`.
- `SessionRecord` gains `pace_feedback`, `mise_s`, and `revisions[]` (with provenance).
- `UserProfile.baseline_session_min?` (optional).
- `Task.optional: bool` (default false) to allow `skipped`.
- `UserProfile.telemetry_consent { given, at, text_version }` and `install_id` (random, resettable).
- New schema `schemas/telemetry-event.schema.json`: an **allowlist** of fields (PRD section 7). The client can only emit events that validate against it.

## 13. Test strategy

| Area | Tests |
|---|---|
| State machine | Table-driven transitions; property test over random event sequences (never reaches an invalid state; process kill at every transition resumes identically) |
| Timer engine | Fake-clock tests: firing order, long-background reconciliation, late timers, clock jumps, simultaneous timers |
| Notifications | Mocked API: correct end and hold-warning schedules, cancellation when the dependent starts, no notification for cancelled timers |
| One-tap capture | `shown_at` rules (including waiting cards and first-view), `sole_focus` derivation, undo, suspicious detection, pause accounting |
| Behind flow | The UI can only display plans that passed the verifier; cancel changes nothing; drop-recipe rules |
| Reconciliation | Hold-exceeded detection and the authored action; welcome-back summary |
| Accessibility and i18n | 200% text scale screenshots, pseudo-locale, screen reader labels, Turkish casing |
| **Real-device protocol (manual)** | Lock-phone timer tests on at least 2 iOS and 3 Android devices (including two different Android vendors), timers of 30 and 90 minutes, silent mode, Do Not Disturb or Focus, low power mode, and after reboot |
| Dogfooding | At least 3 full real sessions cooked by the team before any public beta, measuring planned vs. actual time against the PRD claim |

## 14. Open items

- **Telemetry** is decided (PRD section 7): opt-in, anonymous, allowlisted. Still open: per-task timing ratios keyed by recipe and task ID would greatly help tune recipe durations, but they reveal which recipes people cook, so they are **not** collected now. Adding them needs explicit consent text and a schema change.
- Lock-screen and ongoing-notification timer display, and iOS Live Activities.
- Voice control (deferred in the PRD).
- Label printing.
- How recipe content is delivered: bundled in the app and updated over the air, or fetched as versioned content packs. The render bundle makes running sessions safe either way.
- Landscape-specific layout polish and tablet support.
