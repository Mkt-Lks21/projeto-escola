from __future__ import annotations

import json
import logging
import os
import time
from typing import Any

import pandas as pd
from fastapi import FastAPI, Header, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .errors import ApiError
from .inference import infer_columns
from .plot_builder import build_plotly_figure
from .schemas import (
    ErrorResponse,
    GenerateChartRequest,
    GenerateChartResponse,
    HealthResponse,
    SelectedColumns,
)

def _normalize_env_value(value: str | None, fallback: str | None = None) -> str | None:
    if value is None:
        return fallback

    trimmed = value.strip()
    if not trimmed:
        return fallback

    if len(trimmed) >= 2 and (
        (trimmed.startswith('"') and trimmed.endswith('"'))
        or (trimmed.startswith("'") and trimmed.endswith("'"))
    ):
        trimmed = trimmed[1:-1].strip()

    return trimmed or fallback


LOG_LEVEL = (_normalize_env_value(os.getenv("LOG_LEVEL"), "INFO") or "INFO").upper()
MAX_ROWS = int(_normalize_env_value(os.getenv("MAX_ROWS"), "5000") or "5000")
INTERNAL_API_TOKEN = _normalize_env_value(os.getenv("INTERNAL_API_TOKEN"))

logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("chart_processor")

app = FastAPI(
    title="Chart Processor Service",
    description="FastAPI service for generating Plotly chart JSON from tabular data.",
    version="1.0.0",
)


@app.exception_handler(ApiError)
async def handle_api_error(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.to_dict())


@app.exception_handler(RequestValidationError)
async def handle_request_validation_error(
    _: Request, exc: RequestValidationError
) -> JSONResponse:
    serialized_errors = json.loads(json.dumps(exc.errors(), default=str))
    response = ErrorResponse(
        error_code="INVALID_PAYLOAD",
        message="Invalid request payload.",
        details={"errors": serialized_errors},
    )
    return JSONResponse(status_code=400, content=response.model_dump())


@app.exception_handler(Exception)
async def handle_unexpected_error(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled chart processor exception: %s", exc)
    response = ErrorResponse(
        error_code="INTERNAL_SERVER_ERROR",
        message="Internal server error while generating chart.",
    )
    return JSONResponse(status_code=500, content=response.model_dump())


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/generate-chart",
    response_model=GenerateChartResponse,
    responses={
        400: {"model": ErrorResponse},
        401: {"model": ErrorResponse},
        413: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        500: {"model": ErrorResponse},
    },
)
async def generate_chart(
    payload: GenerateChartRequest,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
) -> GenerateChartResponse:
    started_at = time.perf_counter()
    _validate_internal_token(x_internal_token)

    row_count = len(payload.data)
    if row_count > MAX_ROWS:
        raise ApiError(
            status_code=413,
            error_code="PAYLOAD_TOO_LARGE",
            message=f"Payload exceeds maximum allowed rows ({MAX_ROWS}).",
            details={"max_rows": MAX_ROWS, "received_rows": row_count},
        )

    normalized_rows, normalized_metadata = _normalize_year_month_sales_shape(payload.data)
    if normalized_metadata["applied"]:
        logger.info(
            "chart_data_normalized mode=year_month_to_period metric=%s rows=%s",
            normalized_metadata["metric"],
            len(normalized_rows),
        )

    df = pd.DataFrame(normalized_rows)
    if df.empty or len(df.columns) == 0:
        raise ApiError(
            status_code=400,
            error_code="INVALID_PAYLOAD",
            message="Payload data must contain at least one row with columns.",
        )

    inference = infer_columns(df, payload.chart_intent)
    if normalized_metadata["applied"]:
        inference.warnings.append(
            f"Normalized year/month dataset into Periodo + {normalized_metadata['metric']}."
        )
    plotly_figure, selected_columns = build_plotly_figure(df, inference, payload.title)

    elapsed_ms = round((time.perf_counter() - started_at) * 1000, 2)
    _log_generation_metadata(
        row_count=row_count,
        column_count=len(df.columns),
        chart_type=inference.chart_type,
        latency_ms=elapsed_ms,
    )

    return GenerateChartResponse(
        chart_type_used=inference.chart_type,
        selected_columns=SelectedColumns(**selected_columns),
        plotly_figure=plotly_figure,
        warnings=inference.warnings,
    )


def _validate_internal_token(received_token: str | None) -> None:
    if INTERNAL_API_TOKEN and received_token != INTERNAL_API_TOKEN:
        raise ApiError(
            status_code=401,
            error_code="UNAUTHORIZED",
            message="Invalid or missing X-Internal-Token.",
        )


def _log_generation_metadata(
    row_count: int, column_count: int, chart_type: str, latency_ms: float
) -> None:
    metadata: dict[str, Any] = {
        "rows": row_count,
        "columns": column_count,
        "chart_type": chart_type,
        "latency_ms": latency_ms,
    }
    logger.info("chart_generated %s", metadata)


def _find_case_insensitive_key(row: dict[str, Any], target: str) -> str | None:
    lower_target = target.lower()
    for key in row.keys():
        if key.lower() == lower_target:
            return key
    return None


def _to_int(value: Any) -> int | None:
    try:
        parsed = int(float(value))
        return parsed
    except (TypeError, ValueError):
        return None


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        normalized = value.replace(".", "").replace(",", ".").strip()
        try:
            return float(normalized)
        except ValueError:
            return None
    return None


def _choose_metric_key(rows: list[dict[str, Any]], excluded_keys: set[str]) -> str | None:
    if not rows:
        return None
    sample = rows[0]
    candidates = [
        key for key in sample.keys() if key.lower() not in excluded_keys and _to_float(sample[key]) is not None
    ]
    if not candidates:
        return None
    preferred = next(
        (
            key
            for key in candidates
            if any(token in key.lower() for token in ["total", "venda", "valor", "receita", "fatur"])
        ),
        None,
    )
    return preferred or candidates[0]


def _normalize_year_month_sales_shape(
    rows: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    metadata: dict[str, Any] = {"applied": False, "metric": None}
    if not rows:
        return rows, metadata

    sample = rows[0]
    year_key = _find_case_insensitive_key(sample, "Ano")
    month_key = _find_case_insensitive_key(sample, "Mes")
    if not year_key or not month_key:
        return rows, metadata

    metric_key = _choose_metric_key(rows, {year_key.lower(), month_key.lower()})
    if not metric_key:
        return rows, metadata

    transformed: list[dict[str, Any]] = []
    for row in rows:
        year = _to_int(row.get(year_key))
        month = _to_int(row.get(month_key))
        metric_value = _to_float(row.get(metric_key))
        if year is None or month is None or metric_value is None or month < 1 or month > 12:
            return rows, metadata
        transformed.append(
            {
                "Periodo": f"{year}-{month:02d}",
                metric_key: metric_value,
            }
        )

    metadata["applied"] = True
    metadata["metric"] = metric_key
    return transformed, metadata
