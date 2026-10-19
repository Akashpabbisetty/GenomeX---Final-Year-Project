# Phase 1 — Initial audit (of the original prototype)

## Architecture found
* **Frontend** (`genomx-advisor.html`, `app.js` 1,468 lines, `styles.css`): single page, ~30-drug catalog, rule engine and all clinical text embedded in JavaScript arrays; renders with `innerHTML` template strings.
* **Optional Python backend** (`server.py` + RF / XGBoost / CNN / Bi-LSTM / autoencoder / fusion / GNN): trained on **synthetic** data only; contributed up to 20 of 100 "safety" points.
* **Rule logic duplicated** in `clinical_rules.py` and `app.js`, plus `drug_rules.json` — three copies that had to be kept in sync by hand.
* **Entry points:** `genomx-advisor.html` → `app.js`; `server.py` (`/health`, `/recommend`); `pipeline.py` (CLI).

## Feature inventory → disposition in v2
| Original feature | v2 |
|---|---|
| Home + methodology | Kept; rewritten to state limits, precedence policy and data status |
| Patient profile | Rebuilt as structured inputs with units, dates and inline validation |
| Gene checkboxes | Replaced by per-gene result state (not tested / unknown / result / indeterminate / conflicting) + phenotype |
| Allergy checkboxes | Replaced by structured entries (class, certainty, reaction, severity, date, source, confidence) |
| Compatibility analysis | Rebuilt as deterministic rule engine (`engine/`) |
| Drug directory + modal | Kept; modal shows rules, evidence status and what is *not* known |
| Knowledge graph | Rebuilt: edges only from rules/findings, evidence panel, filters, search, zoom/reset, keyboard access, table fallback |
| Patient timeline | Kept (real timestamps of real stages) |
| CSV / print-PDF export | Rebuilt from one report model shared with the screen |
| Theme, responsive layout | Kept; contrast and focus improved |
| Animated "pipeline" steps | **Removed** — a cosmetic 380 ms/step animation unrelated to real stages |
| Backend / ML scoring | **Moved to `research/`**, no longer in the clinical path |

## Problems found
1. **Clinical claims without sources:** per-drug confidence (75–98), "CPIC Level A/B", "PharmGKB 1A", mechanisms, side effects, alternatives, **48 interaction pairs, 76 diagnosis rules**.
2. **Numeric score could dilute a contraindication** (weights 55/30/12 were invented); ML residual added noise.
3. **Missing data read as normal / safe:** unchecked gene = absent finding = "Safe"; no "not tested" state.
4. **Over-generalised rules:** codeine "<18 = contraindicated"; cephalexin–penicillin "adjust"; TPMT "contraindicated"; clopidogrel without indication; metformin on a yes/no kidney flag; **oxcarbazepine labelled "dose adjustment" (CPIC 2017 says avoid in naive patients)**.
5. **Gene checkboxes conflated genotypes and phenotypes** (e.g. "TPMT deficient / NUDT15 variant" as one box; "DPYD deficient").
6. **Free-text substring matching** for diagnoses and medications (partly fixed in the previous pass; still unsourced).
7. **Inputs that affected nothing:** name, sex, weight, height (BMI display only), history notes. Pregnancy affected only 4 drugs through an unsourced flag.
8. **Security:** 12 `innerHTML` sites (patient free text was not interpolated in the code reviewed, so no XSS was confirmed, but the pattern is fragile); hard-coded `http://localhost:8420` backend; Google Fonts requested externally (leaks IP/usage).
9. **Unreachable / unused code:** `evaluate_clinical_rules()` and `gene_allergy_floor()` in `clinical_rules.py` were never called by the scoring path; `collectPatient().history` unused.
10. **No tests.**

## Implementation checklist (status at end of this pass)
- [x] Rule schema, IDs, versions, evidence records, schema validation, duplicate detection
- [x] Modular engine; precedence policy; data states; no numeric score
- [x] Verified rules for 12 drugs (see DATA_QUALITY.md); everything else "not assessed"
- [x] eGFR-based renal rule; age / breastfeeding rules; allergy certainty handling
- [x] Interaction module as an **unconfigured** integration point (no invented data)
- [x] Explainable results, sources, unknowns; consistent severity scale
- [x] Knowledge graph rebuild; accessible modals; walkthrough; inline validation
- [x] CSV + print report from a single model, CSV-injection guard
- [x] 115 automated tests; reference-set metrics; benchmark
- [ ] Remaining work: see README "Outstanding limitations"
