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

---
# Addendum — audit of the uploaded datasets (v2.1)

| File | What it is | Used for |
|---|---|---|
| `guidelineAnnotations_json.zip` | 217 ClinPGx guideline annotations (DPWG 110, CPIC 78, RNPGx 16, CPNDS 6, + AIOM/ACR/AHA/CFF/AusNZ/SEFF-SEOM), 208 drugs, 41 genes, each with dated history, literature links and a summary | Primary evidence layer; audit of every hand-encoded rule; guideline-pointer findings |
| `genes.zip` | ClinPGx gene table (25,041 genes; ids, HGNC/NCBI/Ensembl, CPIC flag) | Gene catalog (41 genes used); cross-check that rule genes are flagged as having a CPIC guideline |
| `drug_names.tsv`, `meddra_all_se_tsv.gz`, `meddra_freq_tsv.gz` | SIDER 4.1: 1,430 compound ids → 1,344 drugs after merging 147 duplicate names; 140,677 drug–effect pairs (PT level), 58,548 with frequency, 4,251 terms | Label side-effect browser, search-by-effect, history matching |

**Data-quality observations:** duplicate drug names (merged); `5-fu` ↔ fluorouracil and `thyroxine` ↔ levothyroxine mapped by name equivalence (flagged); escitalopram absent from SIDER (not substituted); frequency present for only 41% of pairs and expressed partly as words that SIDER maps to ranges; 419 rows are high-level categories (skipped); SIDER is a mid-2010s label snapshot with no severity.

**What the audit of my own rules found (corrected in v2.1):** abacavir/allopurinol/carbamazepine/oxcarbazepine/codeine/statin rules matched the guideline text; **new** guidance was added — HLA-A*31:01 (carbamazepine), clopidogrel for cardiovascular *and* neurovascular indications with CPIC's named alternatives, compound TPMT+NUDT15, simvastatin dose limit (CPIC <20 mg/day vs DPWG differing), DPYD activity-score detail; evidence now points to guideline annotations dated 2023–2026, not only the original publications. CPIC and DPWG **disagree** on simvastatin and clopidogrel intermediate metabolizers; both are shown.

**Defects found by the tests during this pass (all fixed):** my earlier `sed` produced duplicate `class` keys that silently removed the `section-label` styling from the form headings (shipped in v2.0); nested child arrays rendered as `[object HTMLDivElement]`; gene ids containing `*`/`:` broke `#id` selectors; thiopurine rules cited the other gene's DPWG guideline; label notes wrongly downgraded "No flag". Regression tests now guard each.

---
# Addendum 2 — second upload batch (TG-GATEs, Ensembl, earlier files)
* **Ensembl `homo_sapiens_core_62_37g_sql.gz` / `alt_allele_*.gz`: unchanged and unusable** (73 `CREATE TABLE`, zero rows; 0-byte table). A real dump of the needed tables (or the VCF/BioMart export) is required before any use.
* **`app.js`, `clinical_rules.py`, `README.md` (uploaded):** earlier-iteration files from the original account; they contain the same "severity floor" fix v2 already implements (with tests) plus one unsourced cephalexin–CKD rule. Not encoded: it has no source, and cephalexin labelling doses by creatinine clearance, not eGFR. Candidate for a sourced rule if a CrCl input is added.
* **`files__2_.zip`:** identical to the loaders already in `research/`.
* **Open TG-GATEs** (33,566 array records; 170 compounds; 23,868 rat animals after de-duplication): ingested as a drug-level **preclinical** layer (blood chemistry only). 127 compounds map to catalog drugs (23 pharmaceuticals added by curation), 43 non-drug toxicants/biologics are excluded with reasons. 122 have in-vivo statistics; 16 meet the ALT/AST criterion. 3,000 stored statistics were independently re-derived from the raw table with 0 mismatches. **Measured limitation: acetaminophen, diclofenac, isoniazid and ketoconazole are not flagged** — the rat criterion has limited sensitivity, so "no flag" is never shown as reassurance.
* **CEL arrays (alpidem, 6 files):** still unprocessed — no CDF/probeset annotation supplied, so no gene-level expression exists.
* Defect found by verification: per-endpoint animal counts differed from group counts (e.g. 4 of 10 animals had liver weight); now stored and tested.
