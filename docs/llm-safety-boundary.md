# LLM Adapter Safety Boundary

> **注意**：本文档定义 LLM 安全边界（长期设计原则）。当前阶段不调用真实 LLM API，未来集成时必须遵守本边界。

Phase 4-lite defines how SkyOps Agent can connect to an LLM in the future
without letting the model replace deterministic low-altitude safety decisions.

Current competition demo status:

- No real LLM API is called.
- No API key is required or stored.
- No LangChain, LangGraph, Celery, Redis, or external workflow framework is used.
- The adapter contract is designed so a future real provider can replace a mock
  provider without changing the mission API or hard-rule engine.

## Core Rule

```text
LLM can suggest, but cannot approve flight.
```

The LLM may help the user communicate with the system, but it must not decide
whether a mission is safe, legal, or approved.

## Allowed LLM Responsibilities

Future LLM providers may be used for:

- Task-understanding drafts from natural language input.
- Suggestions for missing task constraints.
- Human-facing explanation drafts after deterministic decisions exist.
- Mission-review narrative drafts after deterministic review data exists.

All outputs must be marked as one of:

- `draft`
- `suggestion`
- `explanation`

## Forbidden LLM Responsibilities

An LLM must not:

- Directly approve a flight.
- Override no-fly-zone, approval, wind, battery, GPS, video-link, crowd-safety,
  or airspace hard constraints.
- Change safety thresholds.
- Lower battery reserve or return-to-home margins.
- Bypass human safety review.
- Recommend execution when information is insufficient or contradictory.
- Replace the explicit rule engine or evaluation system.

## Required Fallback Behavior

The system must fall back to deterministic logic or human review when any of the
following happens:

- Provider timeout.
- Invalid JSON or invalid schema.
- Missing required fields.
- Safety boundary conflict.
- Provider unavailable.

Fallback behavior should be conservative:

- Keep existing hard-rule outputs.
- Mark LLM output as unavailable or invalid.
- Request human review when the missing information affects safety.
- Never use LLM text to bypass a failed hard constraint.

## Current Contract

The Phase 4-lite contract is defined in:

```text
backend/app/integrations/llm/contracts.py
```

It defines:

- `LLMProvider`
- `LLMUsagePolicy`
- `TaskUnderstandingDraft`
- `ConstraintQuestionDraft`
- `ExplanationDraft`
- `ReviewNarrativeDraft`
- `LLMFailureMode`

The deterministic mock provider is defined in:

```text
backend/app/integrations/llm/mock_provider.py
```

`MockLLMProvider` is used only to prove the adapter path is reserved for the
competition demo and tests. A future real provider must conform to the same
contract and preserve the same safety boundary.
