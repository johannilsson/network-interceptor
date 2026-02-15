# ADR-002: Recording Entry Schema

## Status

Accepted

## Context

NDJSON entries need to support grouping, filtering, and analysis for downstream features (schema detection, drift detection, mock generation) without re-parsing URLs or correlating data across lines.

## Decision

Each NDJSON line is a self-contained JSON object with pre-parsed fields:

```jsonl
{"ts":1707900000000,"id":1,"dir":"request","method":"GET","url":"https://api.example.com/users?page=2","host":"api.example.com","path":"/users","query":"page=2","headers":{...},"body":"...","bodyMeta":{...}}
{"ts":1707900000123,"id":1,"dir":"response","status":200,"headers":{...},"body":"{\"users\":[...]}","bodyMeta":{...}}
```

### Required fields (all entries)

| Field | Type | Purpose |
|-------|------|---------|
| `ts` | number | Unix timestamp (ms) |
| `id` | number | Request ID, ties request to response |
| `dir` | `"request"` \| `"response"` | Entry direction |

### Request-specific fields

| Field | Type | Purpose |
|-------|------|---------|
| `method` | string | HTTP method |
| `url` | string | Full URL |
| `host` | string | Hostname (pre-parsed) |
| `path` | string | URL pathname (pre-parsed) |
| `query` | string | Query string (pre-parsed, empty string if none) |
| `headers` | object | Request headers |
| `body` | string \| null | Decompressed body |
| `bodyMeta` | object \| null | Encoding info, truncation flags |

### Response-specific fields

| Field | Type | Purpose |
|-------|------|---------|
| `status` | number | HTTP status code |
| `headers` | object | Response headers |
| `body` | string \| null | Decompressed body |
| `bodyMeta` | object \| null | Encoding info, truncation flags |

## Consequences

- `host` + `path` + `method` enable endpoint grouping without URL parsing on every read.
- `dir` allows filtering by direction without inspecting object shape.
- `id` pairs requests and responses across lines for HAR export, schema detection, and mock generation.
- Pre-parsed fields add ~50-100 bytes per entry but eliminate repeated parsing in all downstream consumers.
- Schema matches the existing `broadcast()` data closely, minimizing mapping code.
