from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

import pandas as pd
from pandas.api.types import is_bool_dtype, is_datetime64_any_dtype

from .errors import ApiError

ChartType = Literal["bar", "line", "pie", "scatter"]


@dataclass
class ColumnTypes:
    numeric: list[str] = field(default_factory=list)
    datetime: list[str] = field(default_factory=list)
    categorical: list[str] = field(default_factory=list)


@dataclass
class InferenceResult:
    chart_type: ChartType
    x_column: str
    y_column: str | None
    mode: Literal["value", "count"]
    x_kind: Literal["datetime", "categorical", "other"]
    series_column: str | None = None
    value_columns: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


SUPPORTED_CHART_TYPES: set[str] = {"bar", "line", "pie", "scatter"}


def normalize_chart_type(requested_chart_type: str) -> tuple[ChartType, list[str]]:
    warnings: list[str] = []
    normalized = (requested_chart_type or "").strip().lower()
    if normalized not in SUPPORTED_CHART_TYPES:
        warnings.append(
            f"Unsupported chart_intent '{requested_chart_type}'. Falling back to 'bar'."
        )
        return "bar", warnings
    return normalized, warnings  # type: ignore[return-value]


def classify_columns(df: pd.DataFrame, ordered_columns: list[str]) -> ColumnTypes:
    column_types = ColumnTypes()

    for column in ordered_columns:
        series = df[column]
        non_null = series.dropna()

        if non_null.empty:
            column_types.categorical.append(column)
            continue

        if is_bool_dtype(series) or non_null.map(lambda value: isinstance(value, bool)).all():
            column_types.categorical.append(column)
            continue

        numeric_cast = pd.to_numeric(non_null, errors="coerce")
        if numeric_cast.notna().all():
            column_types.numeric.append(column)
            continue

        if is_datetime64_any_dtype(series):
            column_types.datetime.append(column)
            continue

        datetime_cast = pd.to_datetime(
            non_null,
            errors="coerce",
            utc=False,
            format="mixed",
        )
        if datetime_cast.notna().all():
            column_types.datetime.append(column)
            continue

        column_types.categorical.append(column)

    return column_types


def infer_columns(df: pd.DataFrame, requested_chart_type: str) -> InferenceResult:
    ordered_columns = list(df.columns)
    if not ordered_columns:
        raise ApiError(
            status_code=400,
            error_code="INVALID_PAYLOAD",
            message="Payload data must contain at least one column.",
        )

    chart_type, warnings = normalize_chart_type(requested_chart_type)
    column_types = classify_columns(df, ordered_columns)

    if chart_type == "scatter":
        return _infer_scatter(column_types, warnings)

    x_column, x_kind = _choose_x_axis(chart_type, ordered_columns, column_types)
    numeric_non_x = [column for column in column_types.numeric if column != x_column]

    # For bar/line comparison scenarios, keep all numeric columns as parallel series.
    if chart_type in {"bar", "line"} and len(numeric_non_x) >= 2:
        return InferenceResult(
            chart_type=chart_type,
            x_column=x_column,
            y_column="__value",
            mode="value",
            x_kind=x_kind,
            series_column="__series",
            value_columns=numeric_non_x,
            warnings=warnings,
        )

    y_column = _pick_first(numeric_non_x)
    mode: Literal["value", "count"] = "value" if y_column else "count"

    if mode == "count":
        warnings.append(
            "No numeric column found for this chart intent. Using category count fallback."
        )

    return InferenceResult(
        chart_type=chart_type,
        x_column=x_column,
        y_column=y_column,
        mode=mode,
        x_kind=x_kind,
        series_column=None,
        value_columns=[],
        warnings=warnings,
    )


def _infer_scatter(column_types: ColumnTypes, warnings: list[str]) -> InferenceResult:
    numeric_columns = column_types.numeric
    if len(numeric_columns) < 2:
        raise ApiError(
            status_code=422,
            error_code="INSUFFICIENT_NUMERIC_COLUMNS",
            message="Scatter chart requires at least two numeric columns.",
            details={"numeric_columns": numeric_columns},
        )

    return InferenceResult(
        chart_type="scatter",
        x_column=numeric_columns[0],
        y_column=numeric_columns[1],
        mode="value",
        x_kind="other",
        series_column=None,
        value_columns=[],
        warnings=warnings,
    )


def _choose_x_axis(
    chart_type: ChartType, ordered_columns: list[str], column_types: ColumnTypes
) -> tuple[str, Literal["datetime", "categorical", "other"]]:
    if chart_type == "line":
        x_column = _pick_first(column_types.datetime)
        if x_column:
            return x_column, "datetime"

        x_column = _pick_first(column_types.categorical)
        if x_column:
            return x_column, "categorical"

    x_column = _pick_first(column_types.categorical)
    if x_column:
        return x_column, "categorical"

    x_column = _pick_first(column_types.datetime)
    if x_column:
        return x_column, "datetime"

    return ordered_columns[0], "other"


def _pick_first(columns: list[str], exclude: set[str] | None = None) -> str | None:
    excluded = exclude or set()
    for column in columns:
        if column not in excluded:
            return column
    return None
