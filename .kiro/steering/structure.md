---
inclusion: always
---
# Structure
`engine/` pure rule engine · `data/` knowledge base (rules, guidelines, adverse, tggates, evidence, sources) · `frontend/` UI · `tests/` · `scripts/` ingest/verify/metrics · `research/` legacy ML (synthetic-only, not used by the app) · `docs/` audit, data quality, engine, security, metrics · `.kiro/specs/` work packages.
Rule files: `data/rules/*.json` (schema enforced by `engine/dataset.js`). Evidence ids: `E-*` hand records, `G:PA…` ClinPGx guideline annotations.
