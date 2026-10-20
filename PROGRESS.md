# GenomX Advisor — Project Progress Log

> Single source of truth for what has been done, what is in flight, and what is next.
> Updated by Kiro. Come back to this file any time to re-orient.

---

## Project in one sentence
GenomX Advisor is an evidence-traceable pharmacogenomic medication-safety screening tool for a final-year/research project. It has a deterministic rule engine (the working app) and a research ML/DL layer (drug→ADR association prediction on a knowledge graph). These two layers are deliberately separate — model output is research-only and never overrides a rule.

---

## Decision log (chronological)

| # | Decision | Reason |
|---|---|---|
| 1 | Dropped the old 0–100 numeric safety score | Weights were invented; a score can dilute an absolute contraindication. The rewrite uses 7 categories with documented precedence. |
| 2 | ML/DL redirected from patient-level scoring to drug→ADR KG prediction | No real patient-genotype+outcome cohort exists. SIDER gives 1,344 drugs × 4,251 real ADR labels — a valid ML task. |
| 3 | ML code built as a portable, take-to-another-machine package | This dev machine has no GPU/torch capability. Code goes in `research/kg/`, trained on a separate ML machine. |
| 4 | Rule-coverage and patient-api-integration run in parallel with ML build | They are independent of training results. |
| 5 | Research paper maintained as a living document alongside the work | Record everything as we go; plug in ML results when training is done. |

---

## Work streams

### Stream 1 — ML/DL code package (`research/kg/`)
**Status:** ✅ COMPLETE — reviewed (APPROVED) and finalized. Portable copy in `genomex-final/ml-package/kg/`.
**What was built** (all verified on Python 3.13, no torch/RDKit):
- `build_graph.py` — builds KG from SIDER + ClinPGx + TG-GATEs → 7 Parquet tables (1,344 drugs, 4,251 terms, 140,677 drug-ADR edges, 41 genes, 481 drug-gene edges)
- `splits.py` — drug-wise cold-start + term-wise + random (optimistic) splits; zero-leakage verified by pytest
- `baselines.py` — popularity prior, kNN (gene-set Jaccard / Tanimoto-ready), logistic regression, matrix factorisation
- `gnn.py` — heterogeneous PyG GNN; lazy torch import (clean import without torch; clear install error when training attempted)
- `metrics.py` — AUROC, AUPRC, precision@k, ECE calibration, bootstrap CIs over held-out drugs
- `ablations.py` — ablation matrix (+genes, +structure, +TG-GATEs, graph vs non-graph); skips torch/RDKit gracefully
- `error_analysis.py` — breakdown by term frequency, drug class, label sparsity
- `export.py` — writes `data/model/assoc_scores.parquet` + `MODEL_CARD.md`
- `run_all.py` — one command, runs everything, prints CAPABILITY BANNER for missing deps
- `requirements.txt`, `METHODS.md`, `PROCESS.md`, `SETUP.md`, `README.md`, `MODEL_CARD.md`
**Portable copy:** `genomex-final/ml-package/kg/` — 14 source files + 7 test files
**YOU do:** Copy `genomex-final/ml-package/kg/` + `data/` to ML machine → follow `SETUP.md` → run `python run_all.py` → copy back `data/model/assoc_scores.parquet` + `figures/`

---

### Stream 2 — Rule coverage (`rule-coverage` spec)
**Status:** ✅ COMPLETE (213/213 tests pass, APPROVED by reviewer)
**What was added:** 38 new cited PGx rules, 8 evidence records, 47 new reference test cases.
**Rules by drug group:**
- CYP2D6 TCAs: amitriptyline, nortriptyline, clomipramine, desipramine, imipramine (13 rules)
- CYP2C19 SSRIs: citalopram, escitalopram, sertraline (6 rules)
- Tacrolimus/CYP3A5 (3 rules)
- Warfarin/CYP2C9+VKORC1+CYP4F2
- Tamoxifen/CYP2D6
- PPIs: omeprazole + lansoprazole / CYP2C19
- Voriconazole/CYP2C19 — PM rule corrected to CPIC primary recommendation (alternative antifungal; DPWG dose-reduction as secondary)
- Irinotecan/UGT1A1
- G6PD drugs: dapsone, methylene blue, pegloticase, rasburicase, tafenoquine, toluidine blue, primaquine (8 rules)
**Documentation:** `docs/RULE_COVERAGE_ADDITIONS.md` + `genomex-final/rule-coverage/RULE_COVERAGE_ADDITIONS.md`

---

### Stream 3 — Patient API integration (`patient-api-integration` spec)
**Status:** ✅ COMPLETE (213/213 tests pass, APPROVED by reviewer)
**What was built:**
- `server/index.js` + `server/evaluate.js` — `/api/evaluate` POST endpoint; validates patient JSON, runs the deterministic engine, returns findings + evidence + ruleSetVersion; NO numeric score; includes disclaimer + data attributions
- `server/auth.js` — auth skeleton with explicit TODO/SECURITY comment (real patient data must not be used until security/ethics review)
- `server/audit.js` — audit log stub (ts + patientId + ruleSetVersion, no PHI)
- `genomex-final/api/batch_evaluate.js` — batch CLI (NDJSON/CSV in → results out, reports throughput)
- `genomex-final/api/synthetic_demo.js` — synthetic patient demo, all 6 categories exercised, SYNTHETIC banner
- `frontend/ui/research-panel.js` + `genomex-final/api/research-panel.js` — research output panel stub (shows "Training results not yet available. Run research/kg/run_all.py on an ML-capable machine." until assoc_scores.parquet exists)
**Reviewer notes (non-blocking for prototype):** CORS wildcard, non-timing-safe auth stub, no body-size cap — document these before any real deployment.

---

### Stream 4 — Research paper (`research-paper` spec)
**Status:** 📝 TO BE SCAFFOLDED (after streams 1–3 settle)
**What it is:** A living paper document that records everything done.
**Structure:** Introduction → Related Work (verify every citation!) → Data & provenance → Methods (engine, KG, models, splits) → Experiments (A: drug-ADR prediction, B: engine-vs-CPIC fidelity, C: rat DILI vs human, ablations) → Results (PLACEHOLDERS until training done) → Limitations → Ethics/safety → Reproducibility
**You do:** Open each cited paper, confirm it exists and says what you claim. Fill in result numbers after ML training.
**Key constraints:** No claim of clinical validity. No superiority claims without baselines+CIs. Every number regenerated by script.

---

## What you do (your action items, in order)

1. **Now — take the ML package to your training machine:**
   - Copy `genomex-final/ml-package/kg/` to your ML machine
   - Copy the project's `data/` folder alongside it
   - Open `SETUP.md` in that folder and follow it step by step
   - Run: `python run_all.py`
   - Copy back `data/model/assoc_scores.parquet` and the `figures/` folder when done

2. **After training — come back here and tell me "training done":**
   - I'll wire the research output panel (it currently shows "not yet available")
   - I'll scaffold the research paper with your real result numbers

3. **Ongoing — verify your citations manually:**
   - Several refs in your methodology doc came from a previous AI session and are unverified
   - Open every cited paper, confirm it exists and says what you claim
   - See `docs/HANDOFF.md` §2 for the full warning

---

## Outstanding blockers / honest limitations

| Item | Status | Notes |
|---|---|---|
| PubChem SMILES structures | Not downloaded | Needed for structure-based features in ML. Download script documented in `research/kg/`; add to `data_raw/pubchem/`. |
| Drug–drug interactions | Not configured | No verified licensed dataset. UI correctly says "not performed". Do not add unsourced pairs. |
| eICU-CRD patient data | Requires PhysioNet account + DUA | Only you can obtain this. Loader is ready. |
| TG-GATEs CEL normalization | No CDF file | Raw probe intensities are unusable without RMA normalization. Either get the CDF or use pre-normalized expression matrix. |
| Real PGx patient cohort | Not available | Patient-level genotype→ADR prediction not feasible without this. Present as future work. |
| Real browser testing | Not done | App is jsdom-tested only. Visual/mobile/a11y testing needed before any real use. |
| Citations in methodology doc | Several unverified | `utm_source=chatgpt.com` in some refs — open every one manually before citing. |

---

## File map (key files to know)

```
GenomeX---Final-Year-Project/
├── engine/              ← Deterministic rule engine (DO NOT modify from ML side)
├── frontend/            ← Web UI
├── data/
│   ├── rules/           ← Hand-encoded cited rules (JSON)
│   ├── guidelines/      ← 217 ClinPGx annotations (pointers, not actions)
│   ├── adverse/         ← SIDER side-effects (1,344 drugs, 140k+ pairs)
│   ├── tggates/         ← TG-GATEs preclinical data
│   └── model/           ← ← ML scores land here after training (assoc_scores.parquet)
├── research/
│   ├── kg/              ← ← NEW: the complete ML/DL pipeline (being built)
│   └── models/          ← Legacy 9-algorithm stack (synthetic only, keep for reference)
├── tests/               ← Engine + UI tests; reference_cases.js
├── scripts/             ← Ingest, validate, metrics scripts
├── docs/
│   ├── HANDOFF.md       ← State of play at project handoff (read this)
│   └── AUDIT.md, ENGINE.md, SECURITY.md, DATA_QUALITY.md
├── .kiro/specs/         ← Scoped work packages (4 specs)
└── PROGRESS.md          ← THIS FILE
```

---

---

## Patient API Integration — Completed

**Task:** `task-patient-api-integration` | **Verdict:** APPROVED (0 blocking findings)

### Files created / modified

| File | What it does |
|------|-------------|
| `server/index.js` | HTTP server — `POST /api/evaluate` validates patient JSON, runs the rule engine, returns findings + evidence + ruleSetVersion + disclaimer. No numeric score field anywhere in responses. CORS wildcard appropriate for local dev only. |
| `server/auth.js` | API-key middleware skeleton. Carries a `SECURITY REVIEW REQUIRED` comment — use `crypto.timingSafeEqual` before any production deployment. |
| `server/audit.js` | Audit-log skeleton. Carries a `PHI — do not log raw patient data` comment. Writes to `logs/` (git-ignored). |
| `genomex-final/api/batch_evaluate.js` | Batch CLI — reads a CSV of patients, runs the engine for each row, writes a results CSV. Uses `fileURLToPath(new URL(...))` for Windows-safe paths. |
| `genomex-final/api/synthetic_demo.js` | Synthetic cohort demo — prints a `SYNTHETIC DATA` banner, exercises all code paths. Monitor-gap note included. |
| `frontend/ui/research-panel.js` | Research output panel stub. Uses only `h()` helper — no `innerHTML`. Wired after ML training produces `data/model/assoc_scores.parquet`. |
| `tests/helpers.js` | Windows path fix — `fileURLToPath(new URL(..., import.meta.url))` so tests resolve fixture paths correctly on Windows. |
| `tests/server.test.js` | 6 server-level test cases: 200 valid patient, 422 validation error, 200 empty body, 404 unknown route, 400 bad JSON, disclaimer match. |

### Test results
- **213 tests, 213 pass, 0 fail** (node --test)
- Server `POST /api/evaluate` with a valid minimal patient returns HTTP 200 with `findings`, `evidence`, `ruleSetVersion`, `disclaimer`, and no numeric score field.

### Production-hardening checklist (before any real patient data)
1. Restrict `Access-Control-Allow-Origin` from `*` to your actual origin.
2. Replace string equality in `auth.js` with `crypto.timingSafeEqual`.
3. Add a body-size cap in `server/index.js` `readBody`.
4. Rotate API keys; never commit them.

*Last updated: patient-api-integration task completed and committed.*
