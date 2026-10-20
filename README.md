# GenomX Advisor

> **Educational prototype. Not clinically validated. Not a medical device. Not for prescribing.**

A pharmacogenomic medication-safety screening system for a final-year research project.
Given a patient's genetics and clinical details, it flags which drugs are risky and why —
with every recommendation traceable to a cited CPIC or DPWG guideline.

---

## What this branch is

This is the **`experiment` branch** — the clean, working version of the project.
It contains only what you need to run the application and the ML research pipeline.
Legacy code, old versions, and duplicate files have been removed.

---

## What it does

**Deterministic rule engine** (works today, no ML needed)
- 60 hand-encoded pharmacogenomic rules citing real CPIC/DPWG guidelines
- 217 ClinPGx guideline annotations shown as evidence pointers
- SIDER label side-effects for 1,344 drugs (informational layer)
- TG-GATEs preclinical toxicogenomic signal (informational layer)
- Seven-category output: avoid / modify / conditional / monitor / needs_info / informational / no_flag
- Missing data is never treated as normal

**ML research layer** (train on a separate machine, optional for the app)
- Knowledge-graph drug→ADR association prediction
- 1,344 drugs × 4,251 ADR terms × 140,677 label edges from real SIDER data
- Baselines + Graph Neural Network (PyTorch Geometric)
- Research output only — never overrides a rule

---

## Quick start — run the app

**Requirements:** Node.js 18 or 22 (https://nodejs.org)

```bash
git clone https://github.com/Akashpabbisetty/GenomeX---Final-Year-Project
cd GenomeX---Final-Year-Project
git checkout experiment
npm install
npm run serve
```

Open: **http://localhost:8000/frontend/genomx-advisor.html**

> Must use `http://` not `file://`

---

## Run the API

```bash
node server/index.js
```

POST to `http://localhost:8080/api/evaluate` with a patient JSON body.
Returns findings, evidence, ruleSetVersion, disclaimer. No numeric score.

```bash
# Quick test (PowerShell)
$body = '{"patientId":"TEST-001","age":45,"sex":"male","renalFunction":"normal","hepaticFunction":"normal","genes":{},"allergies":[],"medications":[],"conditions":[]}'
Invoke-RestMethod -Uri "http://localhost:8080/api/evaluate" -Method Post -Body $body -ContentType "application/json"

# Batch evaluator
node genomex-final/api/batch_evaluate.js patients.ndjson results.ndjson

# Synthetic demo
node genomex-final/api/synthetic_demo.js
```

---

## Run the tests

```bash
node --test "tests/*.test.js"   # 213 tests, all should pass
npm run validate-data           # schema + evidence integrity check
```

---

## ML training (on a capable machine)

Copy two folders to your ML machine:
```
genomex-final/ml-package/kg/    the ML pipeline code
data/                           the knowledge base it reads from
```

Then follow **`genomex-final/ml-package/kg/SETUP.md`** step by step.

```bash
python run_all.py   # trains everything, degrades gracefully without torch/RDKit
```

After training, copy back `data/model/assoc_scores.parquet` — the research panel in the UI will activate automatically.

---

## Folder layout

```
engine/              Rule engine (JS) — the app brain
data/                Knowledge base — rules, guidelines, SIDER, TG-GATEs
  rules/             Hand-encoded cited PGx rules (edit here to add rules)
  guidelines/        217 ClinPGx annotations (read-only)
  adverse/           SIDER side-effects (read-only)
  model/             ML scores land here after training
frontend/            Web UI
server/              /api/evaluate HTTP endpoint
tests/               213 automated tests + reference cases
scripts/             Ingest, validate, metrics tools
research/kg/         Complete ML training pipeline
docs/                Audit trail, data quality, engine docs
.kiro/               Specs and steering rules
genomex-final/       Portable deliverables
  ml-package/kg/     Copy this to your ML machine for training
  paper/             Research paper draft
  api/               Batch CLI and synthetic demo
  rule-coverage/     Rule additions documentation
  RUN_ANYWHERE.md    Full setup guide for any machine
  NAVIGATION_GUIDE.md What to edit vs. what not to touch
  readme_file_manifest_final.md  Which files are needed for what
PROGRESS.md          Full project log — read this to re-orient
```

---

## Key documents

| Document | What it is |
|---|---|
| `PROGRESS.md` | Full project log, all decisions, your action items |
| `genomex-final/RUN_ANYWHERE.md` | Step-by-step setup for any machine |
| `genomex-final/NAVIGATION_GUIDE.md` | Safe vs. dangerous edits, troubleshooting |
| `genomex-final/readme_file_manifest_final.md` | Exactly which files to copy for each use case |
| `genomex-final/paper/PAPER_DRAFT.md` | Research paper draft — fill in ML results after training |
| `genomex-final/ml-package/kg/SETUP.md` | ML machine setup and training guide |
| `genomex-final/ml-package/kg/METHODS.md` | Scientific methodology for the paper |
| `docs/RULE_COVERAGE_ADDITIONS.md` | All 38 new rules added with sources |

---

## After training — what changes

Once you run the ML pipeline and copy back `data/model/assoc_scores.parquet`:
- The "research output" panel in the UI activates and shows drug–ADR association scores
- Fill in `[RESULT: fill after training]` placeholders in `genomex-final/paper/PAPER_DRAFT.md`
- Verify every `[CITE: verify]` citation manually before submitting the paper

---

## Data licences

| Dataset | Licence |
|---|---|
| ClinPGx (PharmGKB) | CC BY-SA 4.0 — attribute, share-alike, non-commercial |
| SIDER 4.1 | CC BY-NC-SA 4.0 — non-commercial, verify before redistribution |
| Open TG-GATEs | CC BY-SA 4.0 — verify current terms |

---

## Disclaimer

GenomX Advisor is an educational research prototype.
It is not a medical device, has not been clinically validated,
and must not be used to make or influence real prescribing decisions.
Model predictions are labelled research output and never override
the deterministic rule engine.
