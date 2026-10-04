from functools import lru_cache
from pathlib import Path

import yaml

from app.core.models import AirspaceConstraint, DroneState, EnvironmentState, RiskItem, RiskLevel
from app.core.rules.models import HardConstraintCheck, RuleEvaluationResult, SafetyRuleConfig

RULE_CONFIG_PATH = Path(__file__).resolve().parent / "safety_rules.yaml"


@lru_cache
def load_safety_rule_config() -> SafetyRuleConfig:
    with RULE_CONFIG_PATH.open("r", encoding="utf-8") as config_file:
        loaded = yaml.safe_load(config_file)

    return SafetyRuleConfig.model_validate(loaded)


def evaluate_hard_constraints(
    environment_state: EnvironmentState,
    airspace_constraint: AirspaceConstraint,
    drone_state: DroneState,
    config: SafetyRuleConfig | None = None,
) -> RuleEvaluationResult:
    active_config = config or load_safety_rule_config()
    checks = [
        evaluate_wind(environment_state, active_config),
        evaluate_battery(drone_state, active_config),
        evaluate_gps(environment_state, active_config),
        evaluate_video_latency(drone_state, active_config),
        evaluate_crowd(environment_state, active_config),
        evaluate_airspace(airspace_constraint, active_config),
    ]

    return RuleEvaluationResult(
        passed=all(check.passed for check in checks),
        checks=checks,
    )


def evaluate_wind(
    environment_state: EnvironmentState,
    config: SafetyRuleConfig,
) -> HardConstraintCheck:
    passed = environment_state.wind_speed_mps < config.max_wind_speed_mps
    return HardConstraintCheck(
        rule_id="hard-wind-speed",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-wind-speed",
            category="weather",
            description="Wind speed exceeds the configured safe operating threshold.",
            severity=RiskLevel.HIGH,
            probability=RiskLevel.HIGH,
            risk_level=RiskLevel.HIGH,
            trigger_condition=f"wind_speed_mps >= {config.max_wind_speed_mps}",
            mitigation="Pause mission and wait for safer wind conditions.",
            evidence=[
                f"observed wind_speed_mps={environment_state.wind_speed_mps}",
                f"max_wind_speed_mps={config.max_wind_speed_mps}",
            ],
            requires_human_confirmation=True,
        ),
        reason="Wind speed is below threshold."
        if passed
        else "Wind speed exceeds the safe operating threshold.",
        evidence=[
            f"wind_speed_mps={environment_state.wind_speed_mps}",
            f"max_wind_speed_mps={config.max_wind_speed_mps}",
        ],
    )


def evaluate_battery(drone_state: DroneState, config: SafetyRuleConfig) -> HardConstraintCheck:
    required_battery = max(
        config.min_battery_percent,
        drone_state.return_to_home_battery_threshold,
    )
    passed = drone_state.battery_percent > required_battery
    return HardConstraintCheck(
        rule_id="hard-battery-margin",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-battery-margin",
            category="battery",
            description="Battery level is not sufficient for safe mission execution and return.",
            severity=RiskLevel.CRITICAL,
            probability=RiskLevel.HIGH,
            risk_level=RiskLevel.CRITICAL,
            trigger_condition=f"battery_percent <= {required_battery}",
            mitigation="Do not launch. Replace battery or split the mission.",
            evidence=[
                f"battery_percent={drone_state.battery_percent}",
                f"required_battery={required_battery}",
            ],
            requires_human_confirmation=True,
        ),
        reason="Battery margin is sufficient."
        if passed
        else "Battery margin is below the configured safe threshold.",
        evidence=[
            f"battery_percent={drone_state.battery_percent}",
            f"required_battery={required_battery}",
        ],
    )


def evaluate_gps(
    environment_state: EnvironmentState,
    config: SafetyRuleConfig,
) -> HardConstraintCheck:
    passed = environment_state.gps_confidence >= config.min_gps_confidence
    return HardConstraintCheck(
        rule_id="hard-gps-confidence",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-gps-confidence",
            category="navigation",
            description="GPS confidence is below the configured safe threshold.",
            severity=RiskLevel.HIGH,
            probability=RiskLevel.MEDIUM,
            risk_level=RiskLevel.HIGH,
            trigger_condition=f"gps_confidence < {config.min_gps_confidence}",
            mitigation="Use conservative standoff route or request manual takeover readiness.",
            evidence=[
                f"gps_confidence={environment_state.gps_confidence}",
                f"min_gps_confidence={config.min_gps_confidence}",
            ],
            requires_human_confirmation=True,
        ),
        reason="GPS confidence is acceptable."
        if passed
        else "GPS confidence is below the configured safe threshold.",
        evidence=[
            f"gps_confidence={environment_state.gps_confidence}",
            f"min_gps_confidence={config.min_gps_confidence}",
        ],
    )


def evaluate_video_latency(
    drone_state: DroneState,
    config: SafetyRuleConfig,
) -> HardConstraintCheck:
    passed = drone_state.video_latency_ms <= config.max_video_latency_ms
    return HardConstraintCheck(
        rule_id="hard-video-latency",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-video-latency",
            category="data_link",
            description="Video transmission latency exceeds the configured safe threshold.",
            severity=RiskLevel.HIGH,
            probability=RiskLevel.MEDIUM,
            risk_level=RiskLevel.HIGH,
            trigger_condition=f"video_latency_ms > {config.max_video_latency_ms}",
            mitigation="Pause mission and restore data link quality before continuing.",
            evidence=[
                f"video_latency_ms={drone_state.video_latency_ms}",
                f"max_video_latency_ms={config.max_video_latency_ms}",
            ],
            requires_human_confirmation=True,
        ),
        reason="Video latency is acceptable."
        if passed
        else "Video latency exceeds the configured safe threshold.",
        evidence=[
            f"video_latency_ms={drone_state.video_latency_ms}",
            f"max_video_latency_ms={config.max_video_latency_ms}",
        ],
    )


def evaluate_crowd(
    environment_state: EnvironmentState,
    config: SafetyRuleConfig,
) -> HardConstraintCheck:
    passed = environment_state.crowd_level not in config.blocked_crowd_levels
    return HardConstraintCheck(
        rule_id="hard-crowd-level",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-crowd-level",
            category="crowd",
            description="Crowd level blocks safe low-altitude operation.",
            severity=RiskLevel.CRITICAL,
            probability=RiskLevel.HIGH,
            risk_level=RiskLevel.CRITICAL,
            trigger_condition=f"crowd_level in {config.blocked_crowd_levels}",
            mitigation="Pause mission or move to a safer time window.",
            evidence=[f"crowd_level={environment_state.crowd_level}"],
            requires_human_confirmation=True,
        ),
        reason="Crowd level does not block the mission."
        if passed
        else "Crowd level blocks safe low-altitude operation.",
        evidence=[f"crowd_level={environment_state.crowd_level}"],
    )


def evaluate_airspace(
    airspace_constraint: AirspaceConstraint,
    config: SafetyRuleConfig,
) -> HardConstraintCheck:
    passed = (not config.require_airspace_flyable) or airspace_constraint.is_flyable
    return HardConstraintCheck(
        rule_id="hard-airspace-flyable",
        passed=passed,
        risk=None
        if passed
        else RiskItem(
            id="hard-risk-airspace-flyable",
            category="airspace",
            description="Airspace constraints indicate the mission is not flyable.",
            severity=RiskLevel.CRITICAL,
            probability=RiskLevel.HIGH,
            risk_level=RiskLevel.CRITICAL,
            trigger_condition="is_flyable == false",
            mitigation="Do not launch. Request compliance review or choose a different plan.",
            evidence=[airspace_constraint.explanation],
            requires_human_confirmation=True,
        ),
        reason="Airspace is marked flyable by the current constraint data."
        if passed
        else "Airspace is not flyable under current constraints.",
        evidence=[airspace_constraint.explanation],
    )
