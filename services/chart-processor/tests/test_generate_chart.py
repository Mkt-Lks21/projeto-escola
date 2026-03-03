from __future__ import annotations

import json

from dateutil.parser import isoparse
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_bar_chart_with_categorical_and_numeric_columns() -> None:
    payload = {
        "data": [
            {"category": "A", "value": 10},
            {"category": "B", "value": 20},
        ],
        "chart_intent": "bar",
        "title": "Bar Test",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "bar"
    assert body["selected_columns"] == {"x": "category", "y": "value", "series": None}
    assert "data" in body["plotly_figure"]
    assert "layout" in body["plotly_figure"]


def test_line_chart_sorts_and_aggregates_duplicate_x_values() -> None:
    payload = {
        "data": [
            {"event_date": "2024-01-02", "revenue": 10},
            {"event_date": "2024-01-01", "revenue": 5},
            {"event_date": "2024-01-01", "revenue": 7},
        ],
        "chart_intent": "line",
        "title": "Line Test",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "line"
    assert body["selected_columns"] == {"x": "event_date", "y": "revenue", "series": None}

    trace = body["plotly_figure"]["data"][0]
    x_values = [isoparse(value).date().isoformat() for value in trace["x"]]
    y_values = list(trace["y"])

    assert x_values == ["2024-01-01", "2024-01-02"]
    assert y_values == [12, 10]


def test_pie_chart_returns_valid_pie_trace() -> None:
    payload = {
        "data": [
            {"segment": "Retail", "sales": 100},
            {"segment": "Wholesale", "sales": 40},
        ],
        "chart_intent": "pie",
        "title": "Pie Test",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "pie"
    assert body["selected_columns"] == {"x": "segment", "y": "sales", "series": None}
    assert body["plotly_figure"]["data"][0]["type"] == "pie"


def test_scatter_chart_with_two_numeric_columns() -> None:
    payload = {
        "data": [
            {"x_val": 1, "y_val": 10, "label": "A"},
            {"x_val": 2, "y_val": 20, "label": "B"},
        ],
        "chart_intent": "scatter",
        "title": "Scatter Test",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "scatter"
    assert body["selected_columns"] == {"x": "x_val", "y": "y_val", "series": None}
    assert body["plotly_figure"]["data"][0]["type"] == "scatter"


def test_bar_chart_fallback_to_count_when_no_numeric_column_exists() -> None:
    payload = {
        "data": [
            {"status": "open"},
            {"status": "open"},
            {"status": "closed"},
        ],
        "chart_intent": "bar",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["selected_columns"] == {"x": "status", "y": "__count", "series": None}
    assert any("count fallback" in warning.lower() for warning in body["warnings"])

    trace = body["plotly_figure"]["data"][0]
    points = dict(zip(trace["x"], trace["y"]))
    assert points["open"] == 2
    assert points["closed"] == 1


def test_empty_payload_returns_invalid_payload_error() -> None:
    response = client.post("/generate-chart", json={"data": [], "chart_intent": "bar"})
    body = response.json()

    assert response.status_code == 400
    assert body["success"] is False
    assert body["error_code"] == "INVALID_PAYLOAD"


def test_invalid_chart_intent_falls_back_to_bar_with_warning() -> None:
    payload = {
        "data": [
            {"category": "A", "value": 5},
            {"category": "B", "value": 6},
        ],
        "chart_intent": "radar",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "bar"
    assert any("falling back to 'bar'" in warning.lower() for warning in body["warnings"])


def test_scatter_with_insufficient_numeric_columns_returns_422() -> None:
    payload = {
        "data": [
            {"value": 1, "category": "A"},
            {"value": 2, "category": "B"},
        ],
        "chart_intent": "scatter",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 422
    assert body["success"] is False
    assert body["error_code"] == "INSUFFICIENT_NUMERIC_COLUMNS"


def test_payload_above_row_limit_returns_413() -> None:
    payload = {
        "data": [{"category": "A", "value": index} for index in range(5001)],
        "chart_intent": "bar",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 413
    assert body["success"] is False
    assert body["error_code"] == "PAYLOAD_TOO_LARGE"


def test_plotly_figure_contract_is_json_serializable() -> None:
    payload = {
        "data": [
            {"category": "A", "value": 10},
            {"category": "B", "value": 15},
        ],
        "chart_intent": "bar",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert "data" in body["plotly_figure"]
    assert "layout" in body["plotly_figure"]
    json.dumps(body["plotly_figure"])


def test_bar_chart_supports_multi_series_wide_comparison() -> None:
    payload = {
        "data": [
            {"trimestre": 1, "vendas_2024": 100, "vendas_2025": 130},
            {"trimestre": 2, "vendas_2024": 120, "vendas_2025": 140},
            {"trimestre": 3, "vendas_2024": 90, "vendas_2025": 160},
            {"trimestre": 4, "vendas_2024": 150, "vendas_2025": 170},
        ],
        "chart_intent": "bar",
        "title": "Comparacao Trimestral",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "bar"
    assert body["selected_columns"] == {
        "x": "trimestre",
        "y": "__value",
        "series": "__series",
    }

    traces = body["plotly_figure"]["data"]
    trace_names = {trace.get("name") for trace in traces}
    assert len(traces) == 2
    assert trace_names == {"vendas_2024", "vendas_2025"}
    assert body["plotly_figure"]["layout"].get("barmode") == "group"


def test_line_chart_supports_multi_series_wide_comparison() -> None:
    payload = {
        "data": [
            {"trimestre": 1, "vendas_2024": 100, "vendas_2025": 130},
            {"trimestre": 2, "vendas_2024": 120, "vendas_2025": 140},
            {"trimestre": 3, "vendas_2024": 90, "vendas_2025": 160},
            {"trimestre": 4, "vendas_2024": 150, "vendas_2025": 170},
        ],
        "chart_intent": "line",
        "title": "Comparacao Trimestral",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "line"
    assert body["selected_columns"] == {
        "x": "trimestre",
        "y": "__value",
        "series": "__series",
    }

    traces = body["plotly_figure"]["data"]
    trace_names = {trace.get("name") for trace in traces}
    assert len(traces) == 2
    assert trace_names == {"vendas_2024", "vendas_2025"}


def test_bar_chart_supports_long_comparison_with_year_as_series() -> None:
    payload = {
        "data": [
            {"trimestre": 1, "ano": 2024, "total_vendas": 100},
            {"trimestre": 1, "ano": 2025, "total_vendas": 130},
            {"trimestre": 2, "ano": 2024, "total_vendas": 120},
            {"trimestre": 2, "ano": 2025, "total_vendas": 140},
            {"trimestre": 3, "ano": 2024, "total_vendas": 90},
            {"trimestre": 3, "ano": 2025, "total_vendas": 160},
            {"trimestre": 4, "ano": 2024, "total_vendas": 150},
            {"trimestre": 4, "ano": 2025, "total_vendas": 170},
        ],
        "chart_intent": "bar",
        "title": "Comparacao Trimestral Long",
    }
    response = client.post("/generate-chart", json=payload)
    body = response.json()

    assert response.status_code == 200
    assert body["chart_type_used"] == "bar"
    assert body["selected_columns"] == {
        "x": "trimestre",
        "y": "total_vendas",
        "series": "ano",
    }

    traces = body["plotly_figure"]["data"]
    trace_names = {trace.get("name") for trace in traces}
    assert trace_names == {"2024", "2025"}
    assert "ano" not in trace_names
    assert "total_vendas" not in trace_names
    assert body["plotly_figure"]["layout"].get("barmode") == "group"
