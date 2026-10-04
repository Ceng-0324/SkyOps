from collections.abc import Iterable, Sequence

from app.core.evaluation.contracts import get_metric_contract
from app.core.models import (
    BaselinePlan,
    EvaluationCase,
    EvaluationItemResult,
    EvaluationMetricName,
    EvaluationResult,
    EvaluationScores,
    ExpectedRisk,
    Explanation,
    MetricScore,
    MissionPlan,
    MissionReview,
    ReplanDecision,
    RiskItem,
    RiskLevel,
)
from app.core.rules import evaluate_hard_constraints

RISK_LEVEL_ORDER = {
    RiskLevel.LOW: 1,
    RiskLevel.MEDIUM: 2,
    RiskLevel.HIGH: 3,
    RiskLevel.CRITICAL: 4,
}

ACTION_ALIASES = {
    "pause": {"pause", "hold", "stop", "abort", "reject takeoff", "delay"},
    "return": {"return", "rth", "home", "launch point", "standby point"},
    "conservative_route": {
        "avoid",
        "conservative",
        "degrade",
        "reroute",
        "reschedule",
        "safe standby",
        "slow",
        "standoff",
        "increase standoff",
        "waypoint",
    },
    "preserve_data": {"preserve", "collected data", "imagery", "telemetry"},
    "makeup_flight": {"makeup", "unfinished", "uncovered", "retry", "skipped"},
    "human_review": {
        "human",
        "manual",
        "pilot",
        "confirmation",
        "review",
        "takeover",
    },
}

UNSAFE_CONTINUE_MARKERS = (
    "continue original route",
    "continue normal route",
    "start normal route",
    "continue despite",
    "finish the current segment before return",
    "hover above crowd",
)


def score_hard_constraints(
    evaluation_case: EvaluationCase,
    mission_plan: MissionPlan,
) -> tuple[float, list[EvaluationItemResult], MetricScore]:
    rule_result = evaluate_hard_constraints(
        environment_state=evaluation_case.environment_state,
        airspace_constraint=evaluation_case.airspace_constraint,
        drone_state=evaluation_case.drone_state,
    )

    results = [
        EvaluationItemResult(
            id=check.rule_id,
            passed=check.passed,
            reason=check.reason,
            evidence=check.evidence,
        )
        for check in rule_result.checks
    ]
    results.extend(_evaluate_plan_dependent_hard_constraints(evaluation_case, mission_plan))

    passed_count = sum(result.passed for result in results)
    score = passed_count / len(results) if results else 1.0
    failed_results = [result for result in results if not result.passed]

    metric_score = MetricScore(
        metric=EvaluationMetricName.HARD_CONSTRAINT_PASS_RATE,
        score=score,
        passed=not failed_results,
        matched_items=[result.id for result in results if result.passed],
        missing_items=[result.id for result in failed_results],
        failure_reasons=[f"{result.id}: {result.reason}" for result in failed_results],
    )
    return score, results, metric_score


def score_risk_recall(
    evaluation_case: EvaluationCase,
    actual_risks: Sequence[RiskItem],
) -> tuple[float, list[EvaluationItemResult], MetricScore]:
    expected_risks = [risk for risk in evaluation_case.expected_risks if risk.must_recall]
    results: list[EvaluationItemResult] = []
    matched_actual_ids: set[str] = set()

    for expected_risk in expected_risks:
        match = next(
            (
                actual_risk
                for actual_risk in actual_risks
                if _risk_matches_expected(actual_risk, expected_risk)
            ),
            None,
        )
        if match is None:
            results.append(
                EvaluationItemResult(
                    id=expected_risk.id,
                    passed=False,
                    reason=(
                        f"{evaluation_case.case_id} missing expected risk "
                        f"{expected_risk.category}:{expected_risk.trigger_condition}."
                    ),
                    evidence=[f"minimum_risk_level={expected_risk.minimum_risk_level}"],
                )
            )
            continue

        matched_actual_ids.add(match.id)
        results.append(
            EvaluationItemResult(
                id=expected_risk.id,
                passed=True,
                reason=f"Matched actual risk {match.id}.",
                evidence=[
                    f"actual_category={match.category}",
                    f"actual_trigger_condition={match.trigger_condition}",
                    f"actual_risk_level={match.risk_level}",
                ],
            )
        )

    unexpected_risks = [risk.id for risk in actual_risks if risk.id not in matched_actual_ids]
    recalled_count = sum(result.passed for result in results)
    score = recalled_count / len(expected_risks) if expected_risks else 1.0
    missing_items = [result.id for result in results if not result.passed]

    metric_score = MetricScore(
        metric=EvaluationMetricName.RISK_RECALL,
        score=score,
        passed=not missing_items,
        matched_items=[result.id for result in results if result.passed],
        missing_items=missing_items,
        failure_reasons=[result.reason for result in results if not result.passed],
    )
    if unexpected_risks:
        metric_score.failure_reasons.append(
            f"Unexpected risks detected: {', '.join(sorted(unexpected_risks))}."
        )

    return score, results, metric_score


def score_incident_response(
    evaluation_case: EvaluationCase,
    replan_decisions: Sequence[ReplanDecision],
) -> tuple[float, list[EvaluationItemResult], MetricScore]:
    results: list[EvaluationItemResult] = []
    decisions_by_incident_id = {decision.incident_id: decision for decision in replan_decisions}
    decisions_by_event_type = {
        event.event_type: decisions_by_incident_id.get(event.id)
        for event in evaluation_case.incident_events
    }

    for behavior in evaluation_case.expected_response_behaviors:
        decision = decisions_by_event_type.get(behavior.incident_type)
        if decision is None and len(replan_decisions) == 1:
            decision = replan_decisions[0]

        if decision is None:
            results.append(
                EvaluationItemResult(
                    id=behavior.id,
                    passed=False,
                    reason=f"No replan decision found for incident type {behavior.incident_type}.",
                    evidence=[f"case_id={evaluation_case.case_id}"],
                )
            )
            continue

        missing_actions = [
            action
            for action in behavior.expected_actions
            if not _action_is_present(action, decision)
        ]
        forbidden_matches = [
            action
            for action in behavior.forbidden_actions
            if _action_is_present(
                action,
                decision,
                include_alternatives=False,
                use_aliases=False,
            )
        ]
        unsafe_continue_matches = [
            marker
            for marker in UNSAFE_CONTINUE_MARKERS
            if marker in _decision_text(decision, include_alternatives=False)
        ]

        if behavior.human_confirmation_required and not decision.human_takeover_required:
            missing_actions.append("human takeover or human review")
        if behavior.makeup_flight_expected and not decision.makeup_flight_required:
            missing_actions.append("makeup flight plan")

        passed = not missing_actions and not forbidden_matches and not unsafe_continue_matches
        reason = "Expected safe response behavior was matched."
        if not passed:
            reason = (
                "Response behavior failed; "
                f"missing={missing_actions}, forbidden={forbidden_matches}, "
                f"unsafe_continue={unsafe_continue_matches}."
            )

        results.append(
            EvaluationItemResult(
                id=behavior.id,
                passed=passed,
                reason=reason,
                evidence=[_decision_text(decision)],
            )
        )

    score = sum(result.passed for result in results) / len(results) if results else 1.0
    missing_items = [result.id for result in results if not result.passed]
    metric_score = MetricScore(
        metric=EvaluationMetricName.INCIDENT_RESPONSE_SCORE,
        score=score,
        passed=not missing_items,
        matched_items=[result.id for result in results if result.passed],
        missing_items=missing_items,
        failure_reasons=[result.reason for result in results if not result.passed],
    )
    return score, results, metric_score


def score_explainability(
    *,
    mission_plan: MissionPlan,
    human_explanation: Explanation,
    replan_decisions: Sequence[ReplanDecision] = (),
    mission_review: MissionReview | None = None,
) -> tuple[float, list[EvaluationItemResult], MetricScore]:
    results = [
        _explanation_field_result("facts", human_explanation.facts),
        _explanation_field_result("inferences", human_explanation.inferences),
        _explanation_field_result("recommended_actions", human_explanation.recommended_actions),
        _explanation_field_result(
            "human_confirmation_required",
            human_explanation.human_confirmation_required,
        ),
    ]

    results.extend(
        _key_decision_explanation_results(mission_plan, replan_decisions, mission_review)
    )

    score = sum(result.passed for result in results) / len(results) if results else 1.0
    missing_items = [result.id for result in results if not result.passed]
    metric_score = MetricScore(
        metric=EvaluationMetricName.EXPLAINABILITY_SCORE,
        score=score,
        passed=not missing_items,
        matched_items=[result.id for result in results if result.passed],
        missing_items=missing_items,
        failure_reasons=[result.reason for result in results if not result.passed],
    )
    return score, results, metric_score


def score_plan_efficiency(
    *,
    evaluation_case: EvaluationCase,
    mission_plan: MissionPlan,
    hard_constraints_passed: bool,
    replan_decisions: Sequence[ReplanDecision] = (),
    mission_review: MissionReview | None = None,
) -> tuple[float, MetricScore]:
    baseline = evaluation_case.baseline_plan
    if baseline is None:
        metric_score = MetricScore(
            metric=EvaluationMetricName.PLAN_EFFICIENCY,
            score=1.0 if hard_constraints_passed else 0.0,
            passed=hard_constraints_passed,
            matched_items=[],
            missing_items=[] if hard_constraints_passed else ["hard_constraints"],
            failure_reasons=[]
            if hard_constraints_passed
            else ["Plan efficiency cannot offset hard constraint failures."],
        )
        return metric_score.score, metric_score

    components = _plan_efficiency_components(
        baseline=baseline,
        mission_plan=mission_plan,
        replan_decisions=replan_decisions,
        mission_review=mission_review,
    )
    raw_score = sum(score for _, score, _ in components) / len(components)
    score = raw_score if hard_constraints_passed else min(raw_score, 0.2)
    matched_items = [name for name, component_score, _ in components if component_score >= 0.7]
    missing_items = [name for name, component_score, _ in components if component_score < 0.7]
    failure_reasons = [
        explanation for _, component_score, explanation in components if component_score < 0.7
    ]

    if not hard_constraints_passed:
        missing_items.append("hard_constraints")
        failure_reasons.append("Plan efficiency cannot offset hard constraint failures.")

    metric_score = MetricScore(
        metric=EvaluationMetricName.PLAN_EFFICIENCY,
        score=score,
        passed=hard_constraints_passed and score >= 0.6,
        matched_items=matched_items,
        missing_items=missing_items,
        failure_reasons=failure_reasons,
    )
    return score, metric_score


def score_evaluation_case(
    *,
    evaluation_case: EvaluationCase,
    mission_plan: MissionPlan,
    risks: Sequence[RiskItem],
    human_explanation: Explanation,
    replan_decisions: Sequence[ReplanDecision] = (),
    mission_review: MissionReview | None = None,
) -> EvaluationResult:
    hard_score, hard_results, hard_metric = score_hard_constraints(
        evaluation_case=evaluation_case,
        mission_plan=mission_plan,
    )
    risk_score, risk_results, risk_metric = score_risk_recall(evaluation_case, risks)
    incident_score, incident_results, incident_metric = score_incident_response(
        evaluation_case,
        replan_decisions,
    )
    explainability_score, explainability_results, explainability_metric = score_explainability(
        mission_plan=mission_plan,
        human_explanation=human_explanation,
        replan_decisions=replan_decisions,
        mission_review=mission_review,
    )
    efficiency_score, efficiency_metric = score_plan_efficiency(
        evaluation_case=evaluation_case,
        mission_plan=mission_plan,
        hard_constraints_passed=hard_metric.passed,
        replan_decisions=replan_decisions,
        mission_review=mission_review,
    )
    metric_scores = [
        hard_metric,
        risk_metric,
        incident_metric,
        explainability_metric,
        efficiency_metric,
    ]
    blocking_metrics = [
        metric for metric in metric_scores if get_metric_contract(metric.metric).blocks_overall_pass
    ]

    return EvaluationResult(
        case_id=evaluation_case.case_id,
        passed=all(metric.passed for metric in blocking_metrics),
        scores=EvaluationScores(
            hard_constraint_pass_rate=hard_score,
            risk_recall=risk_score,
            plan_efficiency=efficiency_score,
            incident_response_score=incident_score,
            explainability_score=explainability_score,
        ),
        metric_scores=metric_scores,
        hard_constraint_results=hard_results,
        risk_recall_results=risk_results,
        incident_response_results=incident_results,
        explainability_results=explainability_results,
        failure_reasons=[
            reason for metric in blocking_metrics for reason in metric.failure_reasons
        ],
        source_type=evaluation_case.source_type,
    )


def _evaluate_plan_dependent_hard_constraints(
    evaluation_case: EvaluationCase,
    mission_plan: MissionPlan,
) -> list[EvaluationItemResult]:
    plan_text = _mission_plan_text(mission_plan)
    airspace = evaluation_case.airspace_constraint
    environment = evaluation_case.environment_state
    config = mission_plan.safety_thresholds

    approval_passed = True
    approval_reason = "Approval is not required by the current mock airspace data."
    if airspace.approval_required:
        approval_passed = "approval" in plan_text and not _contains_any(
            plan_text,
            ("assume approval", "ignore approval", "without approval"),
        )
        approval_reason = (
            "Approval requirement is explicitly gated in the plan."
            if approval_passed
            else "approval_required is true but the plan does not gate execution on approval."
        )

    gps_passed = True
    gps_reason = "GPS confidence does not require plan-level degradation."
    if environment.gps_confidence < config.min_gps_confidence:
        has_active_route = bool(mission_plan.flight_segments)
        conservative_or_manual = _contains_any(
            plan_text,
            ("conservative", "standoff", "manual", "pilot", "human", "takeover", "pause"),
        )
        gps_passed = (not has_active_route) or conservative_or_manual
        gps_reason = (
            "Low GPS confidence is paired with conservative or human-reviewed routing."
            if gps_passed
            else (
                "gps_confidence is below threshold while the plan still proposes "
                "autonomous routing."
            )
        )

    crowd_passed = True
    crowd_reason = "Crowd level does not trigger low-altitude hovering restrictions."
    if environment.crowd_level in {RiskLevel.HIGH, RiskLevel.CRITICAL}:
        crowd_passed = not (
            _contains_any(plan_text, ("hover",))
            and _contains_any(plan_text, ("low-altitude", "low altitude"))
        )
        crowd_reason = (
            "Plan avoids low-altitude hovering in high crowd conditions."
            if crowd_passed
            else "High crowd level is paired with low-altitude hovering."
        )

    return [
        EvaluationItemResult(
            id="hard-airspace-approval",
            passed=approval_passed,
            reason=approval_reason,
            evidence=[
                f"approval_required={airspace.approval_required}",
                f"plan_text_contains_approval={'approval' in plan_text}",
            ],
        ),
        EvaluationItemResult(
            id="hard-gps-autonomous-route",
            passed=gps_passed,
            reason=gps_reason,
            evidence=[
                f"gps_confidence={environment.gps_confidence}",
                f"min_gps_confidence={config.min_gps_confidence}",
                f"flight_segments={len(mission_plan.flight_segments)}",
            ],
        ),
        EvaluationItemResult(
            id="hard-crowd-low-altitude-hover",
            passed=crowd_passed,
            reason=crowd_reason,
            evidence=[f"crowd_level={environment.crowd_level}", mission_plan.route_strategy],
        ),
    ]


def _risk_matches_expected(actual_risk: RiskItem, expected_risk: ExpectedRisk) -> bool:
    return (
        _normalized(actual_risk.category) == _normalized(expected_risk.category)
        and _risk_level_at_least(actual_risk.risk_level, expected_risk.minimum_risk_level)
        and _text_has_overlap(actual_risk.trigger_condition, expected_risk.trigger_condition)
    )


def _risk_level_at_least(actual: RiskLevel, expected_minimum: RiskLevel) -> bool:
    return RISK_LEVEL_ORDER[actual] >= RISK_LEVEL_ORDER[expected_minimum]


def _action_is_present(
    expected_action: str,
    decision: ReplanDecision,
    *,
    include_alternatives: bool = True,
    use_aliases: bool = True,
) -> bool:
    text = _decision_text(decision, include_alternatives=include_alternatives)
    normalized_action = _normalized(expected_action)
    if normalized_action in text:
        return True

    if use_aliases:
        alias_key = _action_alias_key(normalized_action)
        if alias_key is not None:
            if alias_key == "makeup_flight" and decision.makeup_flight_required:
                return True
            if alias_key == "human_review" and decision.human_takeover_required:
                return True
            if _has_action_semantics(alias_key, decision, text):
                return True
            return any(alias in text for alias in ACTION_ALIASES[alias_key])

    expected_tokens = _meaningful_tokens(normalized_action)
    if not expected_tokens:
        return False
    if not use_aliases:
        return set(expected_tokens) <= set(_meaningful_tokens(text))
    return all(token in text for token in expected_tokens)


def _action_alias_key(action: str) -> str | None:
    if any(token in action for token in ("pause", "hold", "stop", "abort", "reject", "delay")):
        return "pause"
    if any(token in action for token in ("return", "home", "rth", "standby")):
        return "return"
    if any(
        token in action
        for token in (
            "avoid",
            "conservative",
            "degrade",
            "standoff",
            "slow",
            "reroute",
            "route",
        )
    ):
        return "conservative_route"
    if any(token in action for token in ("preserve", "data", "imagery", "telemetry", "record")):
        return "preserve_data"
    if any(token in action for token in ("makeup", "unfinished", "uncovered", "skipped")):
        return "makeup_flight"
    if any(token in action for token in ("human", "manual", "pilot", "confirmation", "review")):
        return "human_review"
    return None


def _has_action_semantics(alias_key: str, decision: ReplanDecision, text: str) -> bool:
    match alias_key:
        case "conservative_route":
            return _contains_any(
                text,
                (
                    "increase standoff",
                    "wide-standoff",
                    "safe standby",
                    "conservative waypoint",
                    "degraded",
                    "degrade",
                    "reroute",
                    "avoid close",
                ),
            )
        case "preserve_data":
            return _contains_any(
                text,
                ("record unfinished", "record restricted", "preserve completed"),
            )
        case "makeup_flight":
            return decision.makeup_flight_required or _contains_any(
                text,
                ("mark low-confidence", "record unfinished", "skipped", "schedule makeup"),
            )
        case "human_review":
            return decision.human_takeover_required
        case _:
            return False


def _explanation_field_result(field_name: str, values: Sequence[str]) -> EvaluationItemResult:
    passed = any(value.strip() for value in values)
    return EvaluationItemResult(
        id=f"explanation-{field_name}",
        passed=passed,
        reason=(
            f"human_explanation.{field_name} is present."
            if passed
            else f"human_explanation.{field_name} is missing or empty."
        ),
        evidence=list(values),
    )


def _key_decision_explanation_results(
    mission_plan: MissionPlan,
    replan_decisions: Sequence[ReplanDecision],
    mission_review: MissionReview | None,
) -> list[EvaluationItemResult]:
    plan_text = _mission_plan_text(mission_plan)
    results: list[EvaluationItemResult] = []

    if _contains_any(plan_text, ("delay", "not fly", "no active flight", "no takeoff")):
        results.append(
            _text_explanation_result(
                id="explanation-no-fly-time",
                passed=_contains_any(plan_text, ("because", "exceeds", "threshold", "unsafe")),
                reason="No-fly or delayed time decision must explain why the time is unsafe.",
                evidence=[mission_plan.recommended_time_window, mission_plan.explanation],
            )
        )

    if len(mission_plan.flight_segments) > 1 or _contains_any(plan_text, ("split", "two-segment")):
        results.append(
            _text_explanation_result(
                id="explanation-task-split",
                passed=_contains_any(plan_text, ("split", "segment", "coverage", "battery", "gps")),
                reason="Task split must explain the operational reason.",
                evidence=[mission_plan.route_strategy, mission_plan.explanation],
            )
        )

    for decision in replan_decisions:
        decision_text = _decision_text(decision)
        if _contains_any(decision_text, ("return", "rth", "home", "standby")):
            results.append(
                _text_explanation_result(
                    id=f"explanation-return-{decision.incident_id}",
                    passed=bool(decision.reason.strip()),
                    reason="Return or standby decision must include a reason.",
                    evidence=[decision.reason],
                )
            )
        if decision.makeup_flight_required:
            results.append(
                _text_explanation_result(
                    id=f"explanation-makeup-{decision.incident_id}",
                    passed=(
                        bool(decision.reason.strip())
                        and _contains_any(decision_text, ("makeup", "unfinished", "uncovered"))
                    ),
                    reason="Makeup flight decision must explain unfinished or uncovered work.",
                    evidence=[decision.reason, " ".join(decision.actions)],
                )
            )

    if mission_review is not None and mission_review.makeup_flight_plan:
        review_text = _normalized(" ".join(mission_review.makeup_flight_plan))
        results.append(
            _text_explanation_result(
                id="explanation-review-makeup",
                passed=_contains_any(review_text, ("uncovered", "recheck", "retry", "makeup")),
                reason="Mission review makeup flight plan must explain what remains and why.",
                evidence=mission_review.makeup_flight_plan,
            )
        )

    return results


def _text_explanation_result(
    *,
    id: str,
    passed: bool,
    reason: str,
    evidence: list[str],
) -> EvaluationItemResult:
    return EvaluationItemResult(
        id=id,
        passed=passed,
        reason=reason if not passed else f"{id} is explained.",
        evidence=evidence,
    )


def _plan_efficiency_components(
    *,
    baseline: BaselinePlan,
    mission_plan: MissionPlan,
    replan_decisions: Sequence[ReplanDecision],
    mission_review: MissionReview | None,
) -> list[tuple[str, float, str]]:
    duration_score = _ratio_score(
        actual=mission_plan.estimated_duration_minutes,
        expected=baseline.expected_duration_minutes,
        lower_is_better=True,
        tolerance=1.25,
    )
    split_score = _ratio_score(
        actual=len(mission_plan.flight_segments),
        expected=baseline.task_split_count,
        lower_is_better=True,
        tolerance=1.5,
    )
    coverage_score = _ratio_score(
        actual=mission_plan.expected_coverage_percent,
        expected=baseline.expected_coverage_percent,
        lower_is_better=False,
        tolerance=0.9,
    )
    manual_intervention_count = sum(
        1 for decision in replan_decisions if decision.human_takeover_required
    )
    manual_score = _ratio_score(
        actual=manual_intervention_count,
        expected=baseline.manual_intervention_count,
        lower_is_better=True,
        tolerance=1.5,
    )
    uncovered_count = len(mission_review.uncovered_areas) if mission_review else 0
    makeup_score = 1.0 if uncovered_count == 0 else max(0.0, 1.0 - uncovered_count * 0.15)
    safety_margin_score = 1.0 if baseline.safety_margin_notes else 0.8
    plan_text = _mission_plan_text(mission_plan)
    if _contains_any(plan_text, ("conservative", "safety", "return", "threshold", "approval")):
        safety_margin_score = min(1.0, safety_margin_score + 0.1)

    return [
        (
            "estimated_duration_minutes",
            duration_score,
            (
                "Estimated duration is materially slower than baseline; acceptable only when "
                "paired with safety margin."
            ),
        ),
        (
            "task_split_count",
            split_score,
            "Task split count exceeds baseline tolerance.",
        ),
        (
            "coverage_percent",
            coverage_score,
            "Expected coverage is below baseline tolerance.",
        ),
        (
            "manual_intervention_count",
            manual_score,
            "Manual intervention count exceeds baseline tolerance.",
        ),
        (
            "uncovered_or_makeup_area",
            makeup_score,
            "Uncovered areas or makeup flight load are higher than expected.",
        ),
        (
            "safety_margin",
            safety_margin_score,
            "Plan does not explain safety margin tradeoffs.",
        ),
    ]


def _ratio_score(
    *,
    actual: int,
    expected: int | None,
    lower_is_better: bool,
    tolerance: float,
) -> float:
    if expected is None:
        return 1.0
    if expected == 0:
        return 1.0 if actual == 0 else 0.0
    ratio = actual / expected
    if lower_is_better:
        return 1.0 if ratio <= tolerance else max(0.0, 1.0 - (ratio - tolerance))
    return 1.0 if ratio >= tolerance else max(0.0, ratio / tolerance)


def _mission_plan_text(mission_plan: MissionPlan) -> str:
    return _normalized(
        " ".join(
            [
                mission_plan.recommended_time_window,
                mission_plan.route_strategy,
                " ".join(mission_plan.flight_segments),
                " ".join(mission_plan.abort_conditions),
                " ".join(mission_plan.contingency_plan),
                mission_plan.explanation,
                " ".join(
                    note
                    for point in mission_plan.launch_landing_points
                    for note in point.safety_notes
                ),
            ]
        )
    )


def _decision_text(
    decision: ReplanDecision,
    *,
    include_alternatives: bool = True,
) -> str:
    parts = [
        decision.decision,
        " ".join(decision.actions),
        " ".join(decision.affected_segments),
        decision.reason,
    ]
    if include_alternatives:
        parts.append(" ".join(decision.alternatives_considered))

    return _normalized(" ".join(parts))


def _contains_any(text: str, markers: Iterable[str]) -> bool:
    normalized_text = _normalized(text)
    return any(_normalized(marker) in normalized_text for marker in markers)


def _text_has_overlap(left: str, right: str) -> bool:
    left_tokens = set(_meaningful_tokens(left))
    right_tokens = set(_meaningful_tokens(right))
    if not left_tokens or not right_tokens:
        return _normalized(left) == _normalized(right)
    return bool(left_tokens & right_tokens)


def _meaningful_tokens(text: str) -> list[str]:
    ignored_tokens = {"the", "a", "an", "and", "or", "to", "for", "with", "is", "be"}
    tokens = [
        token.strip(".,:;()[]{}<>=!_")
        for token in _normalized(text).replace("_", " ").replace("-", " ").split()
    ]
    return [token for token in tokens if len(token) > 2 and token not in ignored_tokens]


def _normalized(text: str) -> str:
    return " ".join(text.lower().split())
