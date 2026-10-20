# GenomX Advisor — Run Anywhere Guide
### Complete setup instructions for any machine from scratch

> Keep this file. It tells you everything you need to get any part of
> this project running on a fresh machine, whether that's the web app,
> the API, or the ML training pipeline.

---

## Prerequisites — what you need installed first

| Component | Requires | Download |
|---|---|---|
| Web app + API | Node.js 18 or 22 (LTS) | https://nodejs.org |
| ML pipeline (baselines) | Python 3.11+ | https://python.org |
| ML pipeline (GNN) | Python 3.11+ + GPU/CPU torch | see Section 4 |
| Git (optional) | Git | https://git-scm.com |

No database, no cloud service, no API keys needed.

---

## Section 1 — Get the project onto the new machine

### Option A: Copy the folder directly (simplest)
Copy the entire `GenomeX---Final-Year-Project/` folder to the new machine.
Everything is self-contained — no external services needed.

### Option B: Clone from git
```powershell
git clone <your-repo-url>
cd GenomeX---Final-Year-Project
```

### What to check first
After copying/cloning, confirm these folders exist:
```
data/              ← must be present (knowledge base)
engine/            ← must be present (rule engine)
frontend/          ← must be present (web UI)
genomex-final/     ← your deliverables (may not be git-tracked — recopy if missing)
research/kg/       ← ML pipeline code
```

---

## Section 2 — Run the web app

### Step 1: Install Node.js packages (only needed once)
```powershell
# run from the project root
npm install
```

### Step 2: Start the app
```powershell
npm run serve
```
Then open your browser at: **http://localhost:8000/frontend/genomx-advisor.html**

> **IMPORTANT:** Must use `http://` not `file://` — the app loads engine and
> data files dynamically and file:// will not work.

### Step 3: Verify it works
- The page should load with a patient input form
- Fill in any patient details and click "Evaluate"
- You should see drug recommendations with category labels (avoid / modify / monitor / etc.)
- No numeric score should appear — just category labels and explanations

### Troubleshooting the web app
| Problem | Fix |
|---|---|
| Page loads but shows no drugs | Check browser console for errors; likely a data file path issue |
| "npm: command not found" | Install Node.js from nodejs.org |
| Port 8000 already in use | Edit package.json `serve` script to use a different port |

---

## Section 3 — Run the API server

The API lets you POST a patient JSON and get back structured drug-safety findings.

### Start the server
```powershell
# from the project root
node server/index.js
```
Server starts on **http://localhost:8080** (or the port shown in startup output).

### Test it works
```powershell
# PowerShell — send a test patient
$body = '{"patientId":"TEST-001","age":45,"sex":"male","renalFunction":"normal","hepaticFunction":"normal","genes":{},"allergies":[],"medications":[],"conditions":[]}'
Invoke-RestMethod -Uri "http://localhost:8080/api/evaluate" -Method Post -Body $body -ContentType "application/json"
```

### What the response looks like
```json
{
  "findings": [...],
  "missingInformation": [...],
  "evidence": [...],
  "ruleSetVersion": "...",
  "disclaimer": "Educational prototype. Not clinically validated...",
  "dataAttributions": [...]
}
```
No numeric score. Categories only (avoid / modify / conditional / monitor / needs_info / informational / no_flag).

### Run the synthetic demo
```powershell
node genomex-final/api/synthetic_demo.js
```
Runs 6 synthetic patients through the engine and prints a summary. Look for the `SYNTHETIC DATA` banner.

### Run the batch evaluator
```powershell
# evaluate a file of patients (NDJSON format — one JSON object per line)
node genomex-final/api/batch_evaluate.js patients.ndjson results.ndjson
```

---

## Section 4 — Run the ML training pipeline

This is the part you run on a capable machine (GPU preferred but not required for baselines).

### What this does
Trains drug→adverse-effect association prediction models over a knowledge graph
built from your real SIDER + ClinPGx + TG-GATEs data. Produces research-only
scores — these never feed into the rule engine.

### Step 1: Copy the right folders to your ML machine
You need exactly two folders:
```
genomex-final/ml-package/kg/     ← all the ML code
data/                             ← the knowledge base the code reads from
```
Place them so that `data/` is alongside (or a sibling of) `kg/`, or set the
`GENOMEX_DATA_DIR` environment variable to point at `data/`.

Recommended layout on ML machine:
```
genomex-ml/
├── kg/            ← contents of genomex-final/ml-package/kg/
└── data/          ← contents of data/ from the project root
```

### Step 2: Create a Python virtual environment
```bash
# Linux/Mac
cd genomex-ml/kg
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```
```powershell
# Windows PowerShell
cd genomex-ml\kg
python -m venv .venv
.venv\Scripts\python.exe -m pip install -U pip
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

This installs: numpy, pandas, pyarrow, scikit-learn, scipy, duckdb.
The classical baselines (no GPU) are now ready.

### Step 3: Run the full pipeline (one command)
```bash
# Linux/Mac
python run_all.py

# Windows PowerShell
.venv\Scripts\python.exe run_all.py
```

Expected runtime: 2–10 minutes for baselines only. Add 30–60 min for GNN (if torch installed).

Expected output:
```
=== CAPABILITY BANNER ===
torch       : ABSENT   (GNN will be SKIPPED)
rdkit       : ABSENT   (structure fingerprints will use fallback)
matplotlib  : ABSENT   (figures will be SKIPPED)

[kg.build] loading SIDER drug-ADR labels...
[kg.build] 1344 drugs with positives, 4251 terms, 140677 label edges
...
SKIPPED: GNN (torch not installed)
SKIPPED: structure (RDKit not installed)
SKIPPED: figures (matplotlib not installed)

[kg.export] wrote 140677 rows to data/model/assoc_scores.parquet
[kg.export] MODEL_CARD.md written
Done.
```

### Step 4: Copy results back
After the run, copy these back to the project on your dev machine:
```
data/model/assoc_scores.parquet    ← the association scores
figures/                           ← charts (if matplotlib was installed)
artifacts/ablation_results.parquet ← ablation table
```

### Step 5 (optional): Enable the GNN
Install PyTorch first (CPU-only):
```bash
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```
Or CUDA (replace `cpu` with your CUDA version e.g. `cu121`):
```bash
pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cu121
```
Then install PyTorch Geometric (must match your torch version):
```bash
pip install torch-geometric==2.6.1
pip install pyg_lib torch_scatter torch_sparse torch_cluster torch_spline_conv \
    -f https://data.pyg.org/whl/torch-2.5.1+cpu.html
```
After this, rerun `python run_all.py` — the GNN stage will run instead of being skipped.

### Step 6 (optional): Enable structure fingerprints (RDKit + PubChem)
```bash
pip install rdkit
```
Download PubChem SMILES for the SIDER drug CIDs and place them in `data_raw/pubchem/`
as `CID<number>.smi` files. Then rerun `build_graph.py` — structure features will be enabled.

---

## Section 5 — Run the tests

```powershell
# from the project root — test the rule engine and data
node --test "tests/*.test.js"

# validate all data files
npm run validate-data

# test the ML pipeline (from the project root, using the research venv)
research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests
```

Expected: all tests pass, validate-data exits with no errors.

---

## Section 6 — Quick reference card

| Task | Command | Where to run |
|---|---|---|
| Install Node deps | `npm install` | Project root |
| Run web app | `npm run serve` → http://localhost:8000/frontend/genomx-advisor.html | Project root |
| Run API server | `node server/index.js` | Project root |
| Synthetic demo | `node genomex-final/api/synthetic_demo.js` | Project root |
| JS tests | `node --test "tests/*.test.js"` | Project root |
| Validate data | `npm run validate-data` | Project root |
| ML baselines | `python run_all.py` | ML machine, inside kg/ |
| ML tests | `python -m pytest tests/` | ML machine, inside kg/ |
| Install torch (CPU) | `pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu` | ML machine venv |

---

## Section 7 — Folder layout reminder

```
GenomeX---Final-Year-Project/
├── engine/             Rule engine (JS) — DO NOT touch
├── data/               Knowledge base (JSON) — safe to add rules, not to edit guidelines/adverse
├── frontend/           Web UI
├── server/             API server (Node.js)
├── tests/              Automated tests — run after any change
├── scripts/            Ingest + validate tools
├── research/kg/        ML pipeline (canonical build location)
├── genomex-final/      Your portable deliverables
│   ├── RUN_ANYWHERE.md ← THIS FILE
│   ├── NAVIGATION_GUIDE.md
│   ├── ml-package/kg/  ← copy to ML machine
│   ├── api/            ← batch CLI, synthetic demo
│   └── rule-coverage/  ← RULE_COVERAGE_ADDITIONS.md
└── PROGRESS.md         Project log — read this to re-orient
```

---

*Last updated: end of initial Kiro build session.*
*See PROGRESS.md for full project decision log and NAVIGATION_GUIDE.md for what to edit vs. what not to touch.*
