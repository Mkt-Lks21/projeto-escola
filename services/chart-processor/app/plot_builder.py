from __future__ import annotations

import base64
import json
from typing import Any

import numpy as np
import pandas as pd
import plotly.express as px

from .errors import ApiError
from .inference import InferenceResult


def build_plotly_figure(
    df: pd.DataFrame, inference: InferenceResult, title: str | None
) -> tuple[dict[str, Any], dict[str, str | None]]:
    chart_title = (title or f"{inference.chart_type} chart").strip()
    selected_columns = {"x": inference.x_column, "y": inference.y_column}

    if inference.chart_type == "scatter":
        figure = _build_scatter(df, inference, chart_title)
        return figure, selected_columns

    grouped_df, metric_column = _prepare_grouped_frame(df, inference)

    if inference.mode == "count":
        selected_columns["y"] = "__count"

    if inference.chart_type == "bar":
        fig = px.bar(grouped_df, x=inference.x_column, y=metric_column, title=chart_title)
    elif inference.chart_type == "line":
        fig = px.line(
            grouped_df,
            x=inference.x_column,
            y=metric_column,
            title=chart_title,
            markers=True,
        )
    else:
        fig = px.pie(
            grouped_df,
            names=inference.x_column,
            values=metric_column,
            title=chart_title,
        )

    _apply_default_layout(fig)
    return _normalize_plotly_json(json.loads(fig.to_json())), selected_columns


def _build_scatter(df: pd.DataFrame, inference: InferenceResult, title: str) -> dict[str, Any]:
    if not inference.y_column:
        raise ApiError(
            status_code=422,
            error_code="INSUFFICIENT_NUMERIC_COLUMNS",
            message="Scatter chart requires at least two numeric columns.",
        )

    plot_df = df[[inference.x_column, inference.y_column]].copy()
    plot_df[inference.x_column] = pd.to_numeric(plot_df[inference.x_column], errors="coerce")
    plot_df[inference.y_column] = pd.to_numeric(plot_df[inference.y_column], errors="coerce")
    plot_df = plot_df.dropna(subset=[inference.x_column, inference.y_column])

    if plot_df.empty:
        raise ApiError(
            status_code=422,
            error_code="NO_PLOTTABLE_DATA",
            message="No valid rows available to render this chart.",
        )

    fig = px.scatter(plot_df, x=inference.x_column, y=inference.y_column, title=title)
    _apply_default_layout(fig)
    return _normalize_plotly_json(json.loads(fig.to_json()))


def _prepare_grouped_frame(
    df: pd.DataFrame, inference: InferenceResult
) -> tuple[pd.DataFrame, str]:
    x_column = inference.x_column

    if inference.mode == "count":
        plot_df = df[[x_column]].copy()
        if inference.x_kind == "datetime":
            plot_df[x_column] = pd.to_datetime(
                plot_df[x_column],
                errors="coerce",
                utc=False,
                format="mixed",
            )
        plot_df = plot_df.dropna(subset=[x_column])
        grouped_df = (
            plot_df.groupby(x_column, dropna=False, sort=False)
            .size()
            .reset_index(name="count")
        )
        metric_column = "count"
    else:
        if not inference.y_column:
            raise ApiError(
                status_code=422,
                error_code="INVALID_CHART_CONFIGURATION",
                message="Missing y-axis column for value chart.",
            )

        y_column = inference.y_column
        plot_df = df[[x_column, y_column]].copy()
        if inference.x_kind == "datetime":
            plot_df[x_column] = pd.to_datetime(
                plot_df[x_column],
                errors="coerce",
                utc=False,
                format="mixed",
            )
        plot_df[y_column] = pd.to_numeric(plot_df[y_column], errors="coerce")
        plot_df = plot_df.dropna(subset=[x_column, y_column])
        grouped_df = (
            plot_df.groupby(x_column, dropna=False, sort=False, as_index=False)[y_column]
            .sum()
        )
        metric_column = y_column

    if grouped_df.empty:
        raise ApiError(
            status_code=422,
            error_code="NO_PLOTTABLE_DATA",
            message="No valid rows available to render this chart.",
        )

    if inference.chart_type == "line":
        grouped_df = grouped_df.sort_values(by=x_column, kind="stable")

    return grouped_df, metric_column


def _apply_default_layout(fig: Any) -> None:
    fig.update_layout(
        template="plotly_white",
        autosize=True,
        margin=dict(l=24, r=24, t=48, b=24),
    )


def _normalize_plotly_json(value: Any) -> Any:
    if isinstance(value, dict):
        if set(value.keys()) == {"dtype", "bdata"}:
            decoded = _decode_typed_array(value["dtype"], value["bdata"])
            if decoded is not None:
                return decoded
        return {key: _normalize_plotly_json(item) for key, item in value.items()}

    if isinstance(value, list):
        return [_normalize_plotly_json(item) for item in value]

    return value


def _decode_typed_array(dtype: Any, bdata: Any) -> list[Any] | None:
    if not isinstance(dtype, str) or not isinstance(bdata, str):
        return None

    try:
        raw_bytes = base64.b64decode(bdata)
        np_array = np.frombuffer(raw_bytes, dtype=np.dtype(dtype))
        return np_array.tolist()
    except Exception:
        return None

