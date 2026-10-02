# Phase 3 Evaluation Metric Contracts

> **注意**：本文档定义 Phase 3 评测合约（历史参考）。最新评测指标和基线系统见 [PRODUCT_ROADMAP.md](../PRODUCT_ROADMAP.md) 第五章。

This document defines the Phase 3 evaluation contract for SkyOps Agent. It is a
contract for simulated task-level autonomy evaluation, not a CV defect detection
benchmark and not an LLM judge.

## Scope

Phase 3 evaluates whether the Agent can make safe, explainable, repeatable
mission-level decisions under low-altitude operation constraints.

The evaluation uses `mock` and `simulated` data only. It does not require real
drone control, real airspace data, real map access, or real LLM integration.

## Shared Scorer Output

Every scorer must return a `MetricScore`-compatible result with the same fields:

- `score`: numeric score from `0` to `1`.
- `passed`: whether this metric passes its threshold.
- `matched_items`: expected items that were satisfied.
- `missing_items`: expected items that were not satisfied.
- `failure_reasons`: concise explanations for any failure.

Scorers may produce additional per-item details through `EvaluationItemResult`,
but the summary contract above must remain stable.

## Overall Result Structure

The shared output structure is `EvaluationResult`.

It contains:

- `case_id`: evaluation case id.
- `passed`: overall pass/fail.
- `scores`: one normalized score for each metric.
- `metric_scores`: one summary result per metric.
- `hard_constraint_results`: detailed hard-constraint item results.
- `risk_recall_results`: detailed risk recall item results.
- `incident_response_results`: detailed incident response item results.
- `explainability_results`: detailed explainability item results.
- `failure_reasons`: overall failure reasons.
- `generated_at`: timezone-aware result timestamp.
- `source_type`: `mock` or `simulated` in Phase 3.

## Safety Priority

Hard constraints are a blocking safety gate.

If a plan violates no-fly zones, approval requirements, wind limits, battery
reserve, GPS confidence, crowd safety, or equivalent non-negotiable constraints,
the overall evaluation must fail.

Plan efficiency must never compensate for hard-constraint failure. A shorter
flight time, higher coverage rate, fewer task splits, or lower manual
intervention count cannot offset unsafe or non-compliant behavior.

## Metrics

### 1. Hard Constraint Pass Rate

Role: blocking safety gate.

Focus:

- No-fly zone and non-flyable airspace violations.
- Missing approval verification.
- Wind threshold violations.
- Battery reserve and return-to-home margin.
- GPS confidence below safe operating threshold.
- Low-altitude hover or unsafe routing over high-density crowds.

This metric is evaluated before all quality metrics. Failure blocks the overall
result.

### 2. Risk Recall

Role: quality signal.

Focus:

- Weather risks.
- GPS or navigation risks.
- Airspace and compliance risks.
- Battery and endurance risks.
- Payload and link-quality risks.
- Public-safety risks.

This metric checks whether the Agent notices the risks embedded in an
`EvaluationCase`.

### 3. Incident Response Score

Role: quality signal.

Focus:

- Pause or stop unsafe execution.
- Return home or move to a standby point.
- Switch to a conservative route.
- Preserve collected data.
- Generate a makeup-flight plan.
- Request human review or manual takeover when needed.

High-risk incidents must not continue the original route as if nothing changed.

### 4. Explainability Score

Role: quality signal.

Focus:

- Facts used by the decision.
- Risk inferences.
- Recommended actions.
- Trade-offs and rejected alternatives.
- Human-confirmation requirements.

The Agent should not output only a conclusion; key decisions must be explainable.

### 5. Plan Efficiency

Role: quality signal after safety gates.

Focus:

- Flight duration.
- Coverage percentage.
- Task split count.
- Makeup-flight area or uncovered area.
- Manual intervention count.
- Safety margin against the baseline plan.

Plan efficiency is scored only after the plan satisfies safety and compliance
requirements.

## Implementation Rules For Future Scorers

- Use `backend/app/core/evaluation/contracts.py` as the source of metric order,
  roles, output fields, and safety priority.
- Return `MetricScore` summaries for every metric.
- Use `EvaluationItemResult` for detailed item-level evidence.
- Keep hard safety rules deterministic and explicit.
- Do not use LLM output as the judge for hard safety decisions.
- Keep simulated data clearly marked as `mock` or `simulated`.
