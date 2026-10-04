from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

SCENARIO_DIR = Path(__file__).resolve().parent


class ScenarioNotFoundError(Exception):
    def __init__(self, scenario_id: str) -> None:
        super().__init__(f"Mission scenario not found: {scenario_id}")
        self.scenario_id = scenario_id


@lru_cache
def load_mission_scenario(scenario_id: str) -> dict[str, Any]:
    scenario_path = SCENARIO_DIR / f"{scenario_id}.yaml"

    if not scenario_path.exists():
        raise ScenarioNotFoundError(scenario_id)

    with scenario_path.open("r", encoding="utf-8") as scenario_file:
        loaded = yaml.safe_load(scenario_file)

    if not isinstance(loaded, dict):
        raise ValueError(f"Mission scenario must be a mapping: {scenario_id}")

    if loaded.get("scenario_id") != scenario_id:
        raise ValueError(f"Mission scenario id mismatch: {scenario_id}")

    return loaded
