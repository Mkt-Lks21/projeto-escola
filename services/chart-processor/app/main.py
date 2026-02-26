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

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
MAX_ROWS = int(os.getenv("MAX_ROWS", "5000"))
INTERNAL_API_TOKEN = os.getenv("INTERNAL_API_TOKEN")

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

    df = pd.DataFrame(payload.data)
    if df.empty or len(df.columns) == 0:
        raise ApiError(
            status_code=400,
            error_code="INVALID_PAYLOAD",
            message="Payload data must contain at least one row with columns.",
        )

    inference = infer_columns(df, payload.chart_intent)
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

