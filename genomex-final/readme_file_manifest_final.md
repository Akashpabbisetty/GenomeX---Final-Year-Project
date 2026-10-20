# GenomX Advisor — File Manifest
### Exactly which files you need, for what, and what you can ignore

---

## Scenario A — Run the web app on any machine

Copy these folders/files **only**. Nothing else is required.

```
engine/                  ← rule engine (JS)
data/                    ← knowledge base (JSON)
frontend/                ← web UI
package.json             ← tells npm what to install
package-lock.json        ← pins exact versions
```

Then on the target machine:
```powershell
npm install              # creates node_modules/
npm run serve            # starts http://localhost:8000/frontend/genomx-advisor.html
```

**Minimum copy command (PowerShell):**
```powershell
$src = "c:\Users\spabbisetty\OneDrive - Infor\Desktop\genomex\GenomeX---Final-Year-Project"
$dst = "C:\wherever\genomex-app"
New-Item -ItemType Directory -Path $dst -Force
Copy-Item -Recurse "$src\engine"       "$dst\engine"
Copy-Item -Recurse "$src\data"         "$dst\data"
Copy-Item -Recurse "$src\frontend"     "$dst\frontend"
Copy-Item           "$src\package.json"      "$dst\package.json"
Copy-Item           "$src\package-lock.json" "$dst\package-lock.json"
```

---

## Scenario B — Run the web app + API

Everything in Scenario A, plus:

```
server/                  ← /api/evaluate endpoint
```

```powershell
node server/index.js     # starts API on http://localhost:8080
```

---

## Scenario C — Run the full app + API + tests

Everything in Scenario B, plus:

```
tests/                   ← automated test suite
scripts/                 ← validate-data, metrics, ingest tools
docs/                    ← audit trail and documentation
.kiro/                   ← specs and steering rules
PROGRESS.md              ← project log
genomex-final/           ← your portable deliverables (navigation guide, paper draft, ML package)
```

---

## Scenario D — ML training on another machine

Copy exactly these two things to your ML machine:

```
genomex-final/ml-package/kg/     ← all ML code (15 files + 7 tests)
data/                            ← the knowledge base it reads from
```

Then follow `genomex-final/ml-package/kg/SETUP.md`.

**Minimum copy command:**
```powershell
$src = "c:\Users\spabbisetty\OneDrive - Infor\Desktop\genomex\GenomeX---Final-Year-Project"
$dst = "C:\wherever\genomex-ml"
New-Item -ItemType Directory -Path $dst -Force
Copy-Item -Recurse "$src\genomex-final\ml-package\kg" "$dst\kg"
Copy-Item -Recurse "$src\data"                         "$dst\data"
```

---

## Scenario E — Paper writing only

The files you need to write/finish the paper:

```
genomex-final\paper\PAPER_DRAFT.md          ← the paper draft (fill in results)
genomex-final\rule-coverage\RULE_COVERAGE_ADDITIONS.md  ← rule table for paper
research\kg\METHODS.md                      ← full methodology
research\kg\MODEL_CARD.md                   ← model description
docs\HANDOFF.md                             ← honest state-of-play
PROGRESS.md                                 ← full decision log
```

---

## What IS in the root that you DO NOT need (excess/legacy files)

These files exist because of the project's history — old ML stack versions, raw uploaded data, duplicate files. **None of them are needed by the working app or the new ML pipeline.**

| File/Folder | What it is | Safe to ignore? |
|---|---|---|
| `genomx-v2/` | Old version of the project (superseded) | ✅ Yes |
| `genomx-v2.1/` | Old version of the project (superseded) | ✅ Yes |
| `app.js` | Old frontend JS from the Python-backend era | ✅ Yes (superseded by `frontend/`) |
| `app (2).js` | Duplicate of app.js | ✅ Yes |
| `styles.css` | Old styles at root level | ✅ Yes (superseded by `frontend/styles.css`) |
| `genomx-advisor.html` | Old HTML at root level | ✅ Yes (superseded by `frontend/genomx-advisor.html`) |
| `autoencoder_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `bilstm_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `cnn_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `fusion_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `gnn_model.py` | Old GNN — superseded by `research/kg/gnn.py` | ✅ Yes |
| `random_forest_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `xgboost_model.py` | Old ML model — duplicate of `research/models/` | ✅ Yes |
| `knowledge_graph.py` | Old KG builder — superseded by `research/kg/build_graph.py` | ✅ Yes |
| `clinical_rules.py` | Old Python clinical rules (v1 of scoring) | ✅ Yes |
| `clinical_rules (2).py` | Duplicate of above | ✅ Yes |
| `server.py` | Old Python/FastAPI backend — superseded by `server/` (Node.js) | ✅ Yes |
| `pipeline.py` | Old ML pipeline script | ✅ Yes |
| `explainability.py` | Old explainability — superseded by `research/kg/` | ✅ Yes |
| `data_synthetic.py` | Old synthetic data generator (synthetic only) | ✅ Yes |
| `genomic_encoding.py` | Old genomic encoder | ✅ Yes |
| `drug_rules.json` | Old Python stack drug rules | ✅ Yes |
| `requirements.txt` (root) | Python requirements for old stack — superseded by `research/kg/requirements.txt` | ✅ Yes |
| `cel_parser.py` | Microarray parser (unusable without CDF file) | ✅ Yes |
| `clinpgx_loader.py` | Data loader (superseded by `scripts/ingest/`) | ✅ Yes |
| `eicu_loader.py` | Data loader stub (eICU data not obtained) | ✅ Yes |
| `tggates_loader.py` | Data loader (superseded by ingested `data/tggates/`) | ✅ Yes |
| `drug_names.tsv` | Auxiliary drug name list | ✅ Yes |
| `alpidem.Human.in_vitro.Liver.zip` | Raw CEL microarray data (unusable without CDF) | ✅ Yes |
| `alt_allele.txt.core_62_37g_table.gz` | Ensembl data (empty file, 0 bytes) | ✅ Yes |
| `homo_sapiens_core_62_37g.sql.gz` | Ensembl schema only (no row data) | ✅ Yes |
| `meddra_all_se.tsv.gz` | SIDER raw source — already ingested into `data/adverse/` | ✅ Yes |
| `meddra_freq.tsv.gz` | SIDER raw source — already ingested | ✅ Yes |
| `Open-tggates_AllAttribute.zip` | TG-GATEs raw source — already ingested into `data/tggates/` | ✅ Yes |
| `guidelineAnnotations.json.zip` | ClinPGx raw source — already ingested into `data/guidelines/` | ✅ Yes |
| `genes.zip` | Raw gene data — already ingested | ✅ Yes |
| `files (2).zip` | Unknown archive | ✅ Yes |
| `README.md` / `README (2).md` / `README (3).md` | Old readme versions | ✅ Yes (use `PROGRESS.md`) |
| `START_HERE (2).md` | Old handoff note — absorbed into `PROGRESS.md` | ✅ Yes |
| `server_out.txt` / `server_err.txt` | Log files from a test server run | ✅ Yes |
| `logs/` | Audit log output (git-ignored) | ✅ Yes |
| `.agents/` | Workflow planning artifacts (internal Kiro use) | ✅ Yes |
| `.pytest_cache/` | Python test cache | ✅ Yes |
| `research/models/` | Legacy ML code — synthetic data only, reference only | ✅ Yes (keep for reference if you want, not needed) |

---

## Summary: the files that actually matter

```
GenomeX---Final-Year-Project/
│
├── engine/              ← THE APP BRAIN — do not touch
├── data/                ← THE KNOWLEDGE BASE — rules live here
├── frontend/            ← THE UI
├── server/              ← THE API
├── tests/               ← AUTOMATED TESTS — run after any change
├── scripts/             ← INGEST + VALIDATE TOOLS
├── docs/                ← AUDIT TRAIL
├── research/kg/         ← ML PIPELINE (canonical build)
├── .kiro/               ← SPECS AND RULES
├── package.json         ← NODE CONFIG
├── package-lock.json    ← NODE DEPS LOCK
├── PROGRESS.md          ← PROJECT LOG
│
└── genomex-final/       ← YOUR PORTABLE DELIVERABLES
    ├── FILE_MANIFEST.md          ← THIS FILE
    ├── RUN_ANYWHERE.md           ← setup guide for any machine
    ├── NAVIGATION_GUIDE.md       ← what to edit vs. what not to touch
    ├── ml-package/kg/            ← copy to ML machine for training
    ├── api/                      ← batch CLI, synthetic demo
    ├── rule-coverage/            ← rule additions documentation
    └── paper/PAPER_DRAFT.md      ← research paper draft
```

Everything else in the project root is legacy/raw data and can be ignored.

---

*This manifest was generated at end of the initial Kiro build session.*
