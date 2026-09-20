#!/usr/bin/env python3
"""
Prototype reference validator for the example data (docs/examples).

This is NOT the production validator. It exists so the examples can be checked mechanically and so
Claude Code has a small, readable reference of the semantic rules in docs/data-model.md section 4
and docs/recipe-authoring-guide.md. The real build step lives in the repo (packages/core or a
dedicated data tool) and must implement at least these rules.

Usage:  python3 validate_examples.py [--quiet]
Needs:  pip install pyyaml
Exit code 0 = all checks pass, 1 = errors found.
"""
import glob
import os
import re
import sys

import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = ["en", "tr"]
BASIC_CAPS = {"heat_source", "oven", "pot", "pan"}
OPTIONAL_CAPS = {"rice_cooker", "slow_cooker", "pressure_cooker", "air_fryer",
                 "food_processor", "blender", "stand_mixer"}
OPS = {"wash", "peel", "dice", "slice", "mince", "mix", "season", "marinate", "sear", "saute",
       "simmer", "boil", "roast", "bake", "steam", "blend", "rest", "cool", "portion", "store", "unload"}
ROLES = {"main", "base", "flex", "seasoning", "staple"}
HOLD_KINDS = {"safety", "quality", "continuity"}
HOLD_ACTIONS = {"refrigerate", "keep_covered", "discard_advice"}
DERIVED_KEYS = {"allergens", "diet_flags", "required_capabilities", "macros_per_serving", "prep_estimate"}
ALLERGENS = {"celery", "gluten_cereals", "wheat", "crustaceans", "eggs", "fish", "lupin", "milk",
             "molluscs", "mustard", "peanuts", "sesame", "soybeans", "sulphites", "tree_nuts"}
DIET_FLAGS = {"contains_meat", "contains_fish", "contains_pork", "contains_alcohol",
              "contains_animal_product", "contains_gelatin"}
SECTIONS = {"produce", "meat_fish", "dairy_eggs", "dry_goods", "canned", "frozen", "bakery",
            "spices_oils", "other", "none"}

PLACEHOLDER_RE = re.compile(r"\{([a-z_]+):([^}]*)\}")
RAW_UNIT_RE = re.compile(r"\b\d+([.,]\d+)?\s?(g|kg|ml|l|cm|mm|°C|°F|C|F)\b")

errors, warnings = [], []


def err(where, msg):
    errors.append(f"ERROR {where}: {msg}")


def warn(where, msg):
    warnings.append(f"WARN  {where}: {msg}")


def load(pattern):
    out = {}
    for path in sorted(glob.glob(os.path.join(HERE, pattern))):
        with open(path, encoding="utf-8") as fh:
            out[os.path.basename(path)] = yaml.safe_load(fh)
    return out


# ---------------------------------------------------------------- I18n helpers
def check_i18n(value, where):
    if not isinstance(value, dict):
        err(where, "expected an I18nString mapping")
        return
    for loc in LOCALES:
        v = value.get(loc)
        if not isinstance(v, str) or not v.strip():
            err(where, f"missing or empty locale '{loc}'")


def placeholders(text):
    return sorted(f"{k}:{v}" for k, v in PLACEHOLDER_RE.findall(text))


def check_text(value, where, ingredient_ids):
    """Validates one I18nString used as instruction text."""
    check_i18n(value, where)
    if not isinstance(value, dict):
        return
    sets = {}
    for loc in LOCALES:
        t = value.get(loc)
        if not isinstance(t, str):
            continue
        stripped = PLACEHOLDER_RE.sub("", t)
        if RAW_UNIT_RE.search(stripped):
            err(where, f"[{loc}] raw amount/temperature/length in text, use a placeholder: {t[:60]!r}")
        for kind, arg in PLACEHOLDER_RE.findall(t):
            if kind == "qty":
                if arg not in ingredient_ids:
                    err(where, f"[{loc}] {{qty:{arg}}} is not an ingredient of this recipe")
            elif kind in ("temp_c", "len_cm"):
                try:
                    float(arg)
                except ValueError:
                    err(where, f"[{loc}] {{{kind}:{arg}}} needs a number")
            else:
                err(where, f"[{loc}] unknown placeholder kind '{kind}'")
        leftover = re.sub(r"\{[a-z_]+:[^}]*\}", "", t)
        if "{" in leftover or "}" in leftover:
            err(where, f"[{loc}] malformed placeholder braces")
        sets[loc] = placeholders(t)
    if len(set(map(tuple, sets.values()))) > 1:
        err(where, f"placeholders differ between locales: {sets}")


# ---------------------------------------------------------------- ingredient checks
def check_ingredient(fname, d):
    w = f"ingredients/{fname}"
    if d.get("id") != fname[:-5]:
        err(w, "file name must equal id")
    check_i18n(d.get("names"), f"{w}:names")
    aliases = d.get("aliases", {})
    for loc in LOCALES:
        if not isinstance(aliases.get(loc), list) or not aliases[loc]:
            err(w, f"aliases.{loc} must be a non-empty list")
    src = d.get("source", {})
    if src.get("dataset") == "example_placeholder":
        warn(w, "example_placeholder source (allowed only under docs/examples; CI must reject in data/)")
    n = d.get("per_100g", {})
    for k in ("kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"):
        if not isinstance(n.get(k), (int, float)) or n[k] < 0:
            err(w, f"per_100g.{k} missing or negative")
    if all(isinstance(n.get(k), (int, float)) for k in ("kcal", "protein_g", "fat_g", "carbs_g")):
        est = 4 * n["protein_g"] + 4 * n["carbs_g"] + 9 * n["fat_g"]
        exempt = d.get("validation", {}).get("kcal_check") == "exempt"
        if not exempt and abs(est - n["kcal"]) > 0.10 * max(n["kcal"], 1) and est > 5:
            err(w, f"kcal {n['kcal']} vs 4P+4C+9F={est:.0f} differs by more than 10% (add validation exemption with a reason if justified)")
        if exempt and not d["validation"].get("reason"):
            err(w, "kcal_check exemption needs a reason")
    for a in d.get("allergens", []):
        if a not in ALLERGENS:
            err(w, f"unknown allergen '{a}'")
    for f in d.get("diet_flags", []):
        if f not in DIET_FLAGS:
            err(w, f"unknown diet flag '{f}'")
    sh = d.get("shopping", {})
    if sh.get("section") not in SECTIONS:
        err(w, f"unknown shopping section '{sh.get('section')}'")
    ef = d.get("edible_fraction", 1.0)
    if not (0 < ef <= 1):
        err(w, "edible_fraction must be in (0, 1]")
    y = d.get("yield")
    if y and y.get("mass_factor", 0) <= 0:
        err(w, "yield.mass_factor must be positive")


# ---------------------------------------------------------------- recipe checks
class Recipe:
    def __init__(self, fname, d, ingredients):
        self.fname, self.d, self.ingredients = fname, d, ingredients
        self.w = f"recipes/{fname}"
        self.tasks = {t["id"]: t for t in d.get("tasks", [])}
        self.ing = {i["ingredient_id"]: i for i in d.get("ingredients", [])}
        self.producer = {}
        self._sources = {}

    # -- graph helpers
    def ancestors(self, tid, seen=None):
        seen = seen if seen is not None else set()
        for p in self.tasks[tid].get("needs", []):
            if p in self.tasks and p not in seen:
                seen.add(p)
                self.ancestors(p, seen)
        return seen

    def acyclic(self):
        state = {}

        def visit(t):
            if state.get(t) == 1:
                return False
            if state.get(t) == 2:
                return True
            state[t] = 1
            for p in self.tasks[t].get("needs", []):
                if p in self.tasks and not visit(p):
                    return False
            state[t] = 2
            return True

        return all(visit(t) for t in self.tasks)

    def sources(self, token):
        """Ingredient ids that an input token (ingredient or intermediate) is made from."""
        if token in self._sources:
            return self._sources[token]
        if token in self.ing:
            res = {token}
        elif token in self.producer:
            res = set()
            for t in self.tasks[self.producer[token]].get("inputs", []):
                res |= self.sources(t)
        else:
            res = set()
        self._sources[token] = res
        return res

    def mass_g(self, task):
        srcs = set()
        for t in task.get("inputs", []):
            srcs |= self.sources(t)
        return sum(self.ing[i]["grams"] for i in srcs if i in self.ing)

    # -- validation
    def validate(self):
        d, w = self.d, self.w
        if d.get("id") != self.fname[:-5]:
            err(w, "file name must equal id")
        for k in DERIVED_KEYS:
            if k in d:
                err(w, f"derived field '{k}' must not be hand-written")
        if d.get("status") not in ("draft", "in_review", "published"):
            err(w, "status must be draft | in_review | published")
        check_i18n(d.get("title"), f"{w}:title")
        check_i18n(d.get("description"), f"{w}:description")
        if not isinstance(d.get("base_servings"), int) or d["base_servings"] < 1:
            err(w, "base_servings must be a positive integer")

        # ingredients
        for iid, line in self.ing.items():
            if iid not in self.ingredients:
                err(w, f"unknown ingredient '{iid}'")
            if line.get("role") not in ROLES:
                err(w, f"{iid}: invalid role")
            if not (line.get("grams", 0) > 0):
                err(w, f"{iid}: grams must be positive")
            if "follows" in line and line["follows"] not in self.ing:
                err(w, f"{iid}: follows unknown ingredient '{line['follows']}'")
        for iid in self.ing:
            if iid in self.ingredients and self.ingredients[iid].get("deprecated"):
                err(w, f"{iid} is deprecated")

        # scaling
        sc = d.get("scaling", {})
        if not (sc.get("min_factor", 1) < 1 <= sc.get("max_factor", 1)):
            err(w, "scaling needs min_factor < 1 <= max_factor")
        for fx in sc.get("flex", []):
            if fx["ingredient_id"] not in self.ing:
                err(w, f"flex references unknown ingredient {fx['ingredient_id']}")
            if not (fx["min_factor"] < 1 <= fx["max_factor"]):
                err(w, f"flex range for {fx['ingredient_id']} must contain 1")

        # tasks: ids, needs, cycles
        ids = [t["id"] for t in d.get("tasks", [])]
        if len(ids) != len(set(ids)):
            err(w, "duplicate task ids")
        for t in self.tasks.values():
            for p in t.get("needs", []):
                if p not in self.tasks:
                    err(w, f"task {t['id']} needs unknown task '{p}'")
            for o in t.get("outputs", []):
                if o in self.producer:
                    err(w, f"intermediate '{o}' produced by two tasks")
                self.producer[o] = t["id"]
        if not self.acyclic():
            err(w, "task graph has a cycle")
            return
        if not (3 <= len(self.tasks) <= 25):
            warn(w, f"{len(self.tasks)} tasks (guide suggests roughly 10-20)")

        used_ingredients = set()
        for t in self.tasks.values():
            self.validate_task(t, used_ingredients)
        for iid in self.ing:
            if iid not in used_ingredients:
                err(w, f"ingredient '{iid}' is never used by any task input")

        # storage
        st = d.get("storage", {})
        if not isinstance(st.get("fridge_days"), int):
            err(w, "storage.fridge_days required")
        fz = st.get("freezer_days")
        if fz is not None and not isinstance(fz, int):
            err(w, "storage.freezer_days must be an integer or null")
        check_i18n(st.get("cooling_note"), f"{w}:storage.cooling_note")
        check_i18n(st.get("reheat"), f"{w}:storage.reheat")

        # authoring
        if d.get("status") == "published":
            rb = d.get("authoring", {}).get("reviewed_by", {})
            for loc in LOCALES:
                if not rb.get(loc):
                    err(w, f"published recipe needs a reviewer for locale '{loc}'")

    def validate_task(self, t, used_ingredients):
        w = f"{self.w}:{t['id']}"
        if t.get("op") not in OPS:
            err(w, f"unknown op '{t.get('op')}'")
        anc = self.ancestors(t["id"])
        for tok in t.get("inputs", []):
            if tok in self.ing:
                used_ingredients.add(tok)
            elif tok in self.producer:
                if self.producer[tok] not in anc:
                    err(w, f"input '{tok}' is not produced by an ancestor task")
            else:
                err(w, f"input '{tok}' is neither an ingredient nor an intermediate")
        if not t.get("outputs"):
            err(w, "task needs at least one output")
        # batch key
        bk = t.get("batch_key")
        if bk:
            m = re.fullmatch(r"([a-z_]+):([a-z0-9_]+)", bk)
            if not m:
                err(w, f"batch_key '{bk}' must look like op:ingredient_id")
            else:
                if m.group(1) != t.get("op"):
                    err(w, f"batch_key op '{m.group(1)}' differs from task op '{t.get('op')}'")
                if m.group(2) not in self.ing:
                    err(w, f"batch_key ingredient '{m.group(2)}' is not in this recipe")
        # hold limits
        if "hold_max_min" in t:
            if t["hold_max_min"] < 0:
                err(w, "hold_max_min must be >= 0")
            if t.get("hold_kind") not in HOLD_KINDS:
                err(w, "hold_max_min requires hold_kind (safety | quality | continuity)")
            if t.get("hold_kind") == "continuity" and t["hold_max_min"] > 5:
                err(w, "continuity holds must be 5 minutes or less")
            if t.get("hold_kind") == "safety":
                oh = t.get("on_hold_exceeded", {})
                if oh.get("action") not in HOLD_ACTIONS:
                    err(w, "safety hold needs on_hold_exceeded.action")
                check_text(oh.get("text"), f"{w}:on_hold_exceeded.text", set(self.ing))
        elif "hold_kind" in t:
            err(w, "hold_kind without hold_max_min")
        # methods
        methods = t.get("methods", [])
        baselines = [m for m in methods if m.get("baseline")]
        if len(baselines) != 1:
            err(w, f"needs exactly one baseline method (found {len(baselines)})")
        mids = [m.get("id") for m in methods]
        if len(mids) != len(set(mids)):
            err(w, "duplicate method ids")
        for m in methods:
            self.validate_method(t, m, w)
        # text
        text = t.get("text", {})
        check_text(text.get("brief"), f"{w}:text.brief", set(self.ing))
        check_text(text.get("detailed"), f"{w}:text.detailed", set(self.ing))

    def validate_method(self, t, m, w):
        mw = f"{w}/{m.get('id')}"
        reqs = m.get("requires", [])
        caps = {r["capability"] for r in reqs}
        if m.get("baseline"):
            bad = caps - BASIC_CAPS
            if bad:
                err(mw, f"baseline method may only require basic capabilities, found {sorted(bad)}")
        else:
            if not caps & OPTIONAL_CAPS:
                warn(mw, "non-baseline method requires no optional appliance (why is it not the baseline?)")
            if "text" not in m:
                warn(mw, "accelerator method without its own text (fine only if the physical steps are identical)")
        for c in caps:
            if c not in BASIC_CAPS | OPTIONAL_CAPS:
                err(mw, f"unknown capability '{c}'")
        for r in reqs:
            if r["capability"] == "oven":
                for k in ("temp_c", "tolerance_c", "trays"):
                    if k not in r:
                        err(mw, f"oven requirement needs {k}")
        if "active" not in m:
            err(mw, "method needs an active duration (use fixed_min: 0 for none)")
        for phase in ("active", "passive"):
            ph = m.get(phase)
            if ph:
                if ph.get("fixed_min", 0) < 0 or ph.get("per_100g_min", 0) < 0:
                    err(mw, f"{phase} durations must be non-negative")
        if m.get("passive") and "passive_unattended" not in m and m["passive"].get("fixed_min", 0) > 0:
            pass  # default false is allowed, unattended must be an explicit choice when true
        if "text" in m:
            check_text(m["text"].get("brief"), f"{mw}:text.brief", set(self.ing))
            check_text(m["text"].get("detailed"), f"{mw}:text.detailed", set(self.ing))
        if "max_batch_g" in m and m["max_batch_g"] <= 0:
            err(mw, "max_batch_g must be positive")

    # -- derived data (what the build step must generate)
    def duration(self, m, phase, mass):
        ph = m.get(phase) or {}
        fixed = ph.get("fixed_min", 0)
        per = ph.get("per_100g_min", 0)
        return fixed + (per * mass / 100.0 if ph.get("scales", True) else 0)

    def baseline(self, t):
        return next(m for m in t["methods"] if m.get("baseline"))

    def derived(self):
        base = self.d["base_servings"]
        tot = {"kcal": 0.0, "protein_g": 0.0, "fat_g": 0.0, "carbs_g": 0.0, "fiber_g": 0.0}
        allergens, flags = set(), set()
        for iid, line in self.ing.items():
            ing = self.ingredients[iid]
            for k in tot:
                tot[k] += ing["per_100g"][k] * line["grams"] / 100.0
            allergens |= set(ing.get("allergens", []))
            flags |= set(ing.get("diet_flags", []))
        per_serving = {k: round(v / base, 1) for k, v in tot.items()}
        req = set()
        for t in self.tasks.values():
            for r in self.baseline(t).get("requires", []):
                req.add(r["capability"])
        active = passive = 0.0
        ef = {}

        def finish(tid):
            if tid in ef:
                return ef[tid]
            t = self.tasks[tid]
            m = self.baseline(t)
            mass = self.mass_g(t)
            start = max([finish(p) for p in t.get("needs", [])] or [0])
            ef[tid] = start + self.duration(m, "active", mass) + self.duration(m, "passive", mass)
            return ef[tid]

        for tid, t in self.tasks.items():
            m = self.baseline(t)
            mass = self.mass_g(t)
            active += self.duration(m, "active", mass)
            passive += self.duration(m, "passive", mass)
        crit = max(finish(t) for t in self.tasks)
        return {
            "per_serving": per_serving,
            "allergens": sorted(allergens),
            "diet_flags": sorted(flags),
            "required_capabilities": sorted(req),
            "tasks": len(self.tasks),
            "active_min": round(active, 1),
            "passive_min": round(passive, 1),
            "critical_path_min": round(crit, 1),
        }


def batching_report(recipes):
    """Shows what merging same-batch-key tasks across recipes would save (baseline methods)."""
    groups = {}
    for r in recipes:
        for t in r.tasks.values():
            if t.get("batch_key"):
                groups.setdefault(t["batch_key"], []).append((r, t))
    lines = []
    for key, members in sorted(groups.items()):
        if len(members) < 2:
            continue
        separate = 0.0
        merged_mass = 0.0
        fixed = 0.0
        per = 0.0
        for r, t in members:
            m = r.baseline(t)
            mass = r.mass_g(t)
            separate += r.duration(m, "active", mass)
            merged_mass += mass
            fixed = max(fixed, (m.get("active") or {}).get("fixed_min", 0))
            per = max(per, (m.get("active") or {}).get("per_100g_min", 0))
        merged = fixed + per * merged_mass / 100.0
        lines.append((key, [r.d["id"] for r, _ in members], round(separate, 2), round(merged, 2)))
    return lines


def main():
    quiet = "--quiet" in sys.argv
    ingredients = load("ingredients/*.yaml")
    recipes_raw = load("recipes/*.yaml")
    ing_by_id = {}
    for fname, d in ingredients.items():
        check_ingredient(fname, d)
        ing_by_id[d["id"]] = d
    recipes = []
    for fname, d in recipes_raw.items():
        r = Recipe(fname, d, ing_by_id)
        r.validate()
        recipes.append(r)

    if errors:
        print("\n".join(errors))
    if warnings and not quiet:
        print("\n".join(warnings))
    print(f"\n{len(ingredients)} ingredients, {len(recipes)} recipes checked: "
          f"{len(errors)} error(s), {len(warnings)} warning(s)")
    if errors:
        sys.exit(1)

    if not quiet:
        print("\nDerived data (what the build step must generate; use as test fixtures):")
        for r in recipes:
            dv = r.derived()
            print(f"\n  {r.d['id']}")
            for k, v in dv.items():
                print(f"    {k}: {v}")
        print("\nBatching opportunities across recipes (baseline methods, base servings):")
        for key, rids, sep, mer in batching_report(recipes):
            print(f"  {key}: {rids}  separate {sep} min -> merged {mer} min (saves {round(sep - mer, 2)})")


if __name__ == "__main__":
    main()
