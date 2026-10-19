# GenomX Advisor v2 — evidence-traceable pharmacogenomic screening (PROTOTYPE)

> **Educational prototype. Not clinically validated, not a medical device, not for prescribing.** Absence of a finding is not evidence of safety.

## Run, test
```bash
npm install            # only needed for the UI tests (jsdom); the app itself has no dependencies
npm run validate-data  # schema + evidence integrity of data/
npm test               # 115 tests: engine (95) + UI integration via jsdom (20)
npm run metrics        # reference-set + stress metrics -> docs/metrics.json
npm run bench          # engine timing
npm run data-quality   # regenerates docs/DATA_QUALITY.md from the dataset
npm run serve          # then open http://localhost:8000/frontend/genomx-advisor.html
```
(Serve the **project root**: the page loads `../engine` and `../data` over http. `file://` will not work.)

## Layout
```
engine/      pure rule engine (patient normalisation, evaluators, aggregation, explanations, reports)
data/        versioned JSON: drugs, genes, vocab, evidence, rules/*, interactions (unconfigured), unverified/*
frontend/    genomx-advisor.html, styles.css, ui/ (safe-DOM modules)
tests/       engine + UI tests, fixtures/reference_cases.js (each case cites its source)
docs/        AUDIT.md, DATA_QUALITY.md, ENGINE.md, SECURITY.md, metrics.json, TEST_RESULTS.txt
research/    the original ML stack and legacy code — NOT used by the app; synthetic-data only
scripts/     validate-data, metrics, bench, data-quality, one-off legacy extraction
```

## What needs external services / data
* **Drug–drug interactions:** need a verified/licensed dataset (`data/interactions.json`, currently `not_configured`; screening is *not performed*).
* **CPIC evidence levels:** CPIC's API/table was not retrievable here; levels are `null`. Pull them from the CPIC API with credentials/network access.
* **Genotype → phenotype translation, ontology IDs (RxNorm/ATC), dosing algorithms:** not included.
* No API keys are required or present.

## Outstanding limitations (prioritised)
1. **Verify the remaining 18 catalog drugs** and promote/replace the 6 secondary-evidence and 5 citation-pending rules (see `docs/DATA_QUALITY.md`). Re-check all 11 evidence records for newer guideline versions.
2. Add a verified interaction source and drug–disease / hepatic / pregnancy rules.
3. Real-browser testing (visual, mobile/tablet layout, screen reader). **Only jsdom was available in this environment; responsive layout and colour contrast were reviewed in CSS but not visually verified.**
4. Independent clinical review of rule wording and of the reference cases (they share sources with the rules, so 44/44 agreement is a regression check, not validation).
5. Backend/API with authentication, audit logging and retention if multi-user use is ever intended.
6. Clinical safety case and regulatory assessment before any real-world use.
