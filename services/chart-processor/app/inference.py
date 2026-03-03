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
    categorical_non_x = [
        column for column in column_types.categorical if column != x_column
    ]

    if chart_type in {"bar", "line"}:
        year_like_columns = [
            column for column in numeric_non_x if _is_year_like_series(df[column])
        ]
        series_candidates = [*categorical_non_x, *year_like_columns]
        value_candidates = [
            column for column in numeric_non_x if column not in year_like_columns
        ]

        series_column = _choose_preferred_series_column(
            series_candidates, ordered_columns
        )
        value_column = _choose_preferred_value_column(
            value_candidates, ordered_columns
        )

        # Long mode (period, series, value) has priority when available.
        if series_column and value_column:
            return InferenceResult(
                chart_type=chart_type,
                x_column=x_column,
                y_column=value_column,
                mode="value",
                x_kind=x_kind,
                series_column=series_column,
                value_columns=[],
                warnings=warnings,
            )

        # Wide mode (period, metric_a, metric_b...) remains as fallback.
        if len(value_candidates) >= 2:
            return InferenceResult(
                chart_type=chart_type,
                x_column=x_column,
                y_column="__value",
                mode="value",
                x_kind=x_kind,
                series_column="__series",
                value_columns=value_candidates,
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


def _is_year_like_series(series: pd.Series) -> bool:
    non_null = series.dropna()
    if non_null.empty:
        return False

    numeric = pd.to_numeric(non_null, errors="coerce")
    if numeric.isna().any():
        return False

    rounded = numeric.round()
    if ((numeric - rounded).abs() > 1e-9).any():
        return False

    years = rounded.astype("int64")
    unique_count = years.nunique(dropna=True)
    if unique_count < 2 or unique_count > 20:
        return False

    return bool(years.between(1900, 2100).all())


def _choose_preferred_series_column(
    candidates: list[str], ordered_columns: list[str]
) -> str | None:
    if not candidates:
        return None

    order_index = {name: index for index, name in enumerate(ordered_columns)}

    def score(column: str) -> tuple[int, int]:
        name = column.lower()
        keywords = [
            "ano",
            "year",
            "exercicio",
            "safra",
            "periodo",
            "serie",
            "segmento",
            "categoria",
        ]
        for rank, keyword in enumerate(keywords):
            if keyword in name:
                return rank, order_index.get(column, 10_000)
        return 99, order_index.get(column, 10_000)

    return min(candidates, key=score)


def _choose_preferred_value_column(
    candidates: list[str], ordered_columns: list[str]
) -> str | None:
    if not candidates:
        return None

    order_index = {name: index for index, name in enumerate(ordered_columns)}

    def score(column: str) -> tuple[int, int]:
        name = column.lower()
        keywords = [
            "total",
            "valor",
            "venda",
            "receita",
            "fatur",
            "lucro",
            "margem",
            "quant",
            "qtd",
            "volume",
        ]
        for rank, keyword in enumerate(keywords):
            if keyword in name:
                return rank, order_index.get(column, 10_000)
        return 99, order_index.get(column, 10_000)

    return min(candidates, key=score)
