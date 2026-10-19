# GenomX Advisor v2 — evidence-traceable pharmacogenomic screening (PROTOTYPE)

> **Educational prototype. Not clinically validated, not a medical device, not for prescribing.** Absence of a finding is not evidence of safety.

## What it does now
A deterministic advisor over **three layers of real data**: hand-encoded rules (avoid/modify only from here) · 217 published ClinPGx guideline annotations (CPIC, DPWG, …) shown as side-by-side pointers · SIDER label side effects (browse, search by effect, match to recorded history; informational only). Inputs: age, eGFR+date, indication, breastfeeding, 21 gene results with explicit data states, structured allergies, current medications, treatment history, and recorded conditions/prior adverse events. Missing data is never treated as normal; there is no numeric score.

## Run, test
```bash
npm install            # only for the UI tests (jsdom); the app has no dependencies
npm run validate-data  # schema + evidence + guideline integrity
npm test               # 151 tests: engine, data layer, UI (jsdom)
npm run metrics        # reference set, coverage, alert burden -> docs/metrics.json
npm run bench          # engine timing
npm run data-quality   # regenerates docs/DATA_QUALITY.md
npm run serve          # then open http://localhost:8000/frontend/genomx-advisor.html
# refresh the data from newer ClinPGx / SIDER downloads:
python3 scripts/ingest/ingest.py --raw <folder with the 5 files> --out data
```
Serve the **project root** over http (the page loads `../engine` and `../data`; `file://` will not work).

## Layout
```
engine/      pure rule engine (patient normalisation, evaluators, aggregation, explanations, reports)
data/        versioned JSON: drugs (1,395), genes, vocab, evidence, rules/*, guidelines/, adverse/ (SIDER shards), gene_catalog, sources.json, LICENSE-DATA.md, unverified/ (quarantined legacy)
frontend/    genomx-advisor.html, styles.css, ui/ (safe-DOM modules)
tests/       engine + UI tests, fixtures/reference_cases.js (each case cites its source)
docs/        AUDIT.md, DATA_QUALITY.md, ENGINE.md, SECURITY.md, metrics.json, TEST_RESULTS.txt
research/    the original ML stack and legacy code — NOT used by the app; synthetic-data only
scripts/     ingest/ingest.py (reproducible, idempotent), validate-data, metrics, bench, data-quality
```

## Licences (important)
ClinPGx data is **CC BY-SA 4.0** (attribute, mark changes, share-alike, no sale). The uploaded SIDER files carried **no licence file**; SIDER is believed to be CC BY-NC-SA 4.0 — **verify before redistributing or commercial use**. See `data/LICENSE-DATA.md`.

## What needs external services / data
* **Drug–drug interactions:** need a verified/licensed dataset (`data/interactions.json`, `not_configured`; screening is *not performed*).
* **CPIC evidence levels:** not present in the provided data; never shown.
* **Genotype → phenotype translation, ontology IDs (RxNorm/ATC), dosing algorithms:** not included. No API keys are needed.

## Outstanding limitations (prioritised)
1. **Real-browser testing** (visual, mobile/tablet, screen reader). Only jsdom was available; contrast was computed (all category badges ≥ 6:1) but layout was not viewed.
2. **Encode more guidelines.** 194 drugs have a published guideline but no hand-encoded rule; they only get pointers. Highest value: CYP2D6/CYP2C19 antidepressants, tacrolimus/CYP3A5, warfarin, tamoxifen, PPIs. Each needs a reading of the guideline's phenotype table (the provided JSON has summaries, not phenotype tables).
3. **ClinPGx guideline URLs** are constructed from annotation ids (`/guidelineAnnotation/PA…`); verify they resolve. The SIDER paper DOI was cited from memory.
4. Re-check all evidence for newer versions (CPIC notes DPYD is being updated); add verified interaction, disease, hepatic and pregnancy rules.
5. Independent clinical review of rule wording; the 49 reference cases share sources with the rules, so 49/49 is a regression check, not validation.
6. Authentication/audit logging/retention if multi-user use is intended; clinical safety case and regulatory assessment before any real use.
