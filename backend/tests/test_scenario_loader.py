import pytest

from app.data.scenarios import ScenarioNotFoundError, load_mission_scenario


def test_load_mission_scenario_returns_mock_demo_data() -> None:
    scenario = load_mission_scenario("shenzhen_nanshan_highrise_demo")

    assert scenario["scenario_id"] == "shenzhen_nanshan_highrise_demo"
    assert scenario["mission_task"]["source_type"] == "mock"
    assert scenario["environment_state"]["source_type"] == "mock"
    assert scenario["airspace_constraint"]["source_type"] == "mock"
    assert scenario["drone_state"]["source_type"] == "mock"
    assert len(scenario["risks"]) >= 2


def test_load_mission_scenario_raises_for_unknown_scenario() -> None:
    with pytest.raises(ScenarioNotFoundError):
        load_mission_scenario("unknown_scenario")
