"""Confirms the generated Pydantic model accepts the same fixture the
generated TypeScript type does (packages/core/src/generated-ingredient.test.ts),
proving the two codegen targets agree on one schema (M0 acceptance test)."""

import json
from pathlib import Path

from generated.ingredient import Ingredient

FIXTURE = Path(__file__).resolve().parents[3] / "schemas" / "fixtures" / "sample-ingredient.json"


def test_sample_ingredient_round_trips_through_the_generated_model() -> None:
    data = json.loads(FIXTURE.read_text())

    ingredient = Ingredient.model_validate(data)

    assert ingredient.id.root == "rice_white_long_raw"
    assert ingredient.names.en == "White rice, long grain, raw"
    assert ingredient.per_100g.kcal == 365

    round_tripped = json.loads(ingredient.model_dump_json(by_alias=True, exclude_none=True))
    assert round_tripped["id"] == data["id"]
    assert round_tripped["shopping"]["section"] == data["shopping"]["section"]
    assert round_tripped["yield"] == data["yield"]
