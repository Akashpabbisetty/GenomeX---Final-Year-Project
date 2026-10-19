# Design
- Encode rules in `data/rules/pgx.json` (schema in `docs/ENGINE.md`); extend conditions only through `engine/evaluators/*`.
- Fidelity harness: `scripts/validate_vs_cpic.mjs` (reads CPIC tables in `data_raw/cpic/`), output → `docs/metrics.json`.
- DILI harness: `scripts/ingest/ingest_dilirank.py` + `scripts/eval_tggates_vs_dili.py` (match by drug id; report unmatched).
- Add CrCl as an optional input only together with a sourced rule that needs it.
