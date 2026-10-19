# START HERE (GenomX Advisor v2.2 — handoff to Kiro)

1. Read `docs/HANDOFF.md` (state of play, decisions, plan, paper plan, data checklist).
2. Open this folder in Kiro. The `.kiro/steering/` files load automatically; the four specs are in `.kiro/specs/`.
3. `npm install && npm test` (160 tests should pass) then `npm run serve` and open http://localhost:8000/frontend/genomx-advisor.html
4. Put your raw downloads in `data_raw/` (never commit them): the 5 files from batch 1, the TG-GATEs/Ensembl files from batch 2, plus anything new.
5. In Kiro, start with spec **kg-adr-prediction** (the primary research experiment), then **rule-coverage**, then **patient-api-integration**, and write **research-paper** alongside.

**Rules that must survive the move** (they are in `.kiro/steering/product.md`): no numeric safety score; missing data is never "normal"; only hand-encoded, cited rules may say avoid/modify; model outputs are labelled research output and never override rules; no invented clinical facts or citations.
