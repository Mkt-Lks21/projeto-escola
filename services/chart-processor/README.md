# Chart Processor (Frente 1)

Microservice in Python (FastAPI + Pandas + Plotly) to generate chart payloads from tabular SQL results.

## Goal

Receive raw rows plus chart intent, infer chart columns deterministically, and return Plotly JSON ready for frontend rendering (`plotly.js` / `react-plotly.js`).

## Structure

```txt
services/chart-processor/
  app/
    __init__.py
    errors.py
    inference.py
    main.py
    plot_builder.py
    schemas.py
  tests/
    test_generate_chart.py
  .env.example
  .gitignore
  Dockerfile
  requirements.txt
```

## Requirements

- Python 3.11+
- Dependencies from `requirements.txt`

## Run locally

```bash
cd services/chart-processor
python -m venv .venv
.venv/Scripts/activate  # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## Environment variables

- `MAX_ROWS` (default: `5000`)
- `LOG_LEVEL` (default: `INFO`)
- `INTERNAL_API_TOKEN` (optional): when set, requests must include `X-Internal-Token`.

## Endpoints

### `GET /health`

Response:

```json
{
  "status": "ok"
}
```

### `POST /generate-chart`

Request:

```json
{
  "data": [
    { "category": "A", "amount": 10 },
    { "category": "B", "amount": 20 }
  ],
  "chart_intent": "bar",
  "title": "Sales by Category"
}
```

Success response:

```json
{
  "success": true,
  "chart_type_used": "bar",
  "selected_columns": {
    "x": "category",
    "y": "amount"
  },
  "plotly_figure": {
    "data": [],
    "layout": {}
  },
  "warnings": []
}
```

Error response example:

```json
{
  "success": false,
  "error_code": "INVALID_PAYLOAD",
  "message": "Invalid request payload.",
  "details": {}
}
```

## Inference rules implemented

- Column groups: `numeric`, `datetime`, `categorical`.
- `bar`:
  - `x`: first categorical (or datetime, then first column fallback)
  - `y`: first numeric
  - no numeric: fallback to counts by `x`
- `line`:
  - `x`: first datetime (or categorical, then first column fallback)
  - `y`: first numeric
  - duplicate `x`: aggregated with `sum`
  - sorted by `x`
  - no numeric: fallback to counts by `x`
- `pie`:
  - `names`: first categorical (or datetime, then first column fallback)
  - `values`: first numeric
  - no numeric: fallback to counts by category
- `scatter`:
  - requires at least 2 numeric columns
  - otherwise returns `INSUFFICIENT_NUMERIC_COLUMNS`
- invalid `chart_intent`:
  - falls back to `bar` with warning

## Default chart layout

- `template = plotly_white`
- `autosize = true`
- `margin = { l: 24, r: 24, t: 48, b: 24 }`

## Tests

Run:

```bash
cd services/chart-processor
pytest -q
```

The suite covers the mandatory scenarios for Frente 1.

## Integration contract for Frente 2

The edge function flow can call this service as:

1. Execute SQL query.
2. Send rows in `data` to `POST /generate-chart`.
3. Read `plotly_figure` and return it to frontend.
