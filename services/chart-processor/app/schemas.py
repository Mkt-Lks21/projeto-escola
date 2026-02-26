from __future__ import annotations

import math
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class GenerateChartRequest(BaseModel):
    data: list[dict[str, Any]]
    chart_intent: str = "bar"
    title: str | None = Field(default=None, max_length=200)

    @field_validator("chart_intent")
    @classmethod
    def normalize_chart_intent(cls, value: str) -> str:
        normalized = value.strip().lower() if isinstance(value, str) else "bar"
        return normalized or "bar"

    @field_validator("data")
    @classmethod
    def validate_data(cls, value: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not value:
            raise ValueError("data must not be empty")

        for row_index, row in enumerate(value):
            if not isinstance(row, dict):
                raise ValueError(f"row {row_index} must be an object")
            if not row:
                raise ValueError(f"row {row_index} must contain at least one column")

            for key, cell_value in row.items():
                if not isinstance(key, str) or not key.strip():
                    raise ValueError(f"row {row_index} has an invalid column name")
                if isinstance(cell_value, (list, tuple, set, dict)):
                    raise ValueError(
                        f"row {row_index}, column '{key}' has unsupported value type"
                    )
                if isinstance(cell_value, float) and math.isnan(cell_value):
                    raise ValueError(
                        f"row {row_index}, column '{key}' has NaN, use null instead"
                    )

        return value


class SelectedColumns(BaseModel):
    x: str
    y: str | None = None


class GenerateChartResponse(BaseModel):
    success: Literal[True] = True
    chart_type_used: str
    selected_columns: SelectedColumns
    plotly_figure: dict[str, Any]
    warnings: list[str] = Field(default_factory=list)


class ErrorResponse(BaseModel):
    success: Literal[False] = False
    error_code: str
    message: str
    details: dict[str, Any] = Field(default_factory=dict)

