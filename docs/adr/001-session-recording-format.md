# ADR-001: Use NDJSON for Session Recording

## Status

Accepted

## Context

We want to record proxy sessions (all request/response traffic) for later replay, export, and analysis. The recording format needs to support:

- Live streaming (append during recording without buffering)
- Crash resilience (partial recordings remain usable)
- Downstream processing: schema detection, drift detection, mock generation
- Export to HAR for interoperability with external tools

Candidates considered:

| Format | Streaming | Crash-safe | Simplicity |
|--------|-----------|------------|------------|
| Single JSON file | No | No | High |
| HAR (JSON) | No | No | Medium |
| NDJSON | Yes | Yes | High |
| SQLite | Yes | Yes | Low |

## Decision

Use NDJSON (newline-delimited JSON) as the live recording format. One file per session, stored in `recordings/`.

HAR is supported as an export format only, generated on demand from NDJSON files.

## Consequences

- Each broadcast event is appended as a single JSON line — minimal overhead, no in-memory buffering.
- Partial files are valid up to the last complete line; no data loss on crash.
- Files can be processed with standard streaming tools (`readline`, `jq`, shell pipelines).
- Downstream features (schema detection, mocks) operate on simple streaming passes.
- HAR export requires a conversion step that pairs request/response entries by ID, but this is straightforward.
- Large sessions with big response bodies will produce large files. Body truncation/exclusion may be needed later.
