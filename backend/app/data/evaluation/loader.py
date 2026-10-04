from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from app.core.models import EvaluationCase, EvaluationCaseFixture

EVALUATION_CASE_DIR = Path(__file__).resolve().parent
EVALUATION_CASE_SUFFIXES = {".yaml", ".yml"}


class EvaluationDatasetError(Exception):
    """Base error for evaluation dataset loading failures."""


class EvaluationDatasetNotFoundError(EvaluationDatasetError):
    def __init__(self, case_dir: Path) -> None:
        super().__init__(f"Evaluation dataset directory not found: {case_dir}")
        self.case_dir = case_dir


class EvaluationCaseNotFoundError(EvaluationDatasetError):
    def __init__(self, case_id: str) -> None:
        super().__init__(f"Evaluation case not found: {case_id}")
        self.case_id = case_id


class DuplicateEvaluationCaseIdError(EvaluationDatasetError):
    def __init__(self, case_id: str, paths: list[Path]) -> None:
        joined_paths = ", ".join(str(path) for path in paths)
        super().__init__(f"Duplicate evaluation case id: {case_id} ({joined_paths})")
        self.case_id = case_id
        self.paths = paths


class EvaluationCaseFormatError(EvaluationDatasetError):
    def __init__(self, path: Path, reason: str) -> None:
        super().__init__(f"Invalid evaluation case file: {path}: {reason}")
        self.path = path
        self.reason = reason


def load_all_evaluation_cases(case_dir: str | Path | None = None) -> list[EvaluationCase]:
    return [
        fixture.evaluation_case for fixture in load_all_evaluation_case_fixtures(case_dir=case_dir)
    ]


def load_all_evaluation_case_fixtures(
    case_dir: str | Path | None = None,
) -> list[EvaluationCaseFixture]:
    fixtures_by_case_id: dict[str, tuple[Path, EvaluationCaseFixture]] = {}

    for case_path in _iter_evaluation_case_paths(_resolve_case_dir(case_dir)):
        fixture = load_evaluation_case_fixture_from_path(case_path)
        case_id = fixture.evaluation_case.case_id

        if case_id in fixtures_by_case_id:
            first_path = fixtures_by_case_id[case_id][0]
            raise DuplicateEvaluationCaseIdError(case_id, [first_path, case_path])

        fixtures_by_case_id[case_id] = (case_path, fixture)

    return [fixture for _, fixture in fixtures_by_case_id.values()]


def load_evaluation_case(
    case_id: str,
    case_dir: str | Path | None = None,
) -> EvaluationCase:
    return load_evaluation_case_fixture(case_id=case_id, case_dir=case_dir).evaluation_case


def load_evaluation_case_fixture(
    case_id: str,
    case_dir: str | Path | None = None,
) -> EvaluationCaseFixture:
    for fixture in load_all_evaluation_case_fixtures(case_dir=case_dir):
        if fixture.evaluation_case.case_id == case_id:
            return fixture

    raise EvaluationCaseNotFoundError(case_id)


def load_evaluation_case_fixture_from_path(path: str | Path) -> EvaluationCaseFixture:
    case_path = Path(path)
    raw_case = _load_yaml_mapping(case_path)

    try:
        return EvaluationCaseFixture.model_validate(raw_case)
    except ValidationError as error:
        raise EvaluationCaseFormatError(case_path, str(error)) from error


def _resolve_case_dir(case_dir: str | Path | None) -> Path:
    return EVALUATION_CASE_DIR if case_dir is None else Path(case_dir)


def _iter_evaluation_case_paths(case_dir: Path) -> list[Path]:
    if not case_dir.exists() or not case_dir.is_dir():
        raise EvaluationDatasetNotFoundError(case_dir)

    return sorted(
        path
        for path in case_dir.iterdir()
        if path.is_file() and path.suffix.lower() in EVALUATION_CASE_SUFFIXES
    )


def _load_yaml_mapping(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as case_file:
            loaded = yaml.safe_load(case_file)
    except yaml.YAMLError as error:
        raise EvaluationCaseFormatError(path, f"YAML parse error: {error}") from error

    if not isinstance(loaded, dict):
        raise EvaluationCaseFormatError(path, "evaluation case file must be a mapping")

    return loaded
