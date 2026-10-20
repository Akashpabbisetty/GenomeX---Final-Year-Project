# PROCESS -- running the drug->ADR research pipeline (PowerShell)

Step-by-step run guide for Windows PowerShell. The classical pipeline runs
end-to-end with only the core dependencies; torch / RDKit / matplotlib are
optional and their stages are SKIPPED (with an explicit message) when absent.

All commands invoke the venv interpreter BY PATH. Do not prefix with `& ` --
that form is denied in this workspace. Paths are repo-relative; run from the
repository root unless noted (the scripts resolve data paths against the repo
root, so any cwd works).

## 1. Create the venv and install core dependencies

```powershell
python -m venv research/kg/.venv
research/kg/.venv/Scripts/python.exe -m pip install -U pip
research/kg/.venv/Scripts/python.exe -m pip install -r research/kg/requirements.txt
```

Installed core: numpy, pandas, pyarrow, scikit-learn, scipy, duckdb (pinned in
`requirements.txt`). This is everything the classical pipeline needs.

## 2. Run the whole pipeline (one command)

```powershell
research/kg/.venv/Scripts/python.exe research/kg/run_all.py
```

This runs build_graph -> splits -> metrics -> baselines -> (GNN if torch) ->
ablations -> error_analysis -> export. At the top it prints a CAPABILITY
BANNER listing which optional dependencies are present or absent, and it
prints explicit SKIPPED lines for any stage whose dependency is missing.

Expected outputs on the classical venv:
- `research/kg/artifacts/*.parquet` -- graph node/edge/feature tables,
  `ablation_results.parquet`, and the three `error_analysis_*.parquet`.
- `research/kg/artifacts/provenance.json` -- SHA-256 digests + licences.
- `data/model/assoc_scores.parquet` -- RESEARCH-ONLY association scores
  (columns `drug_id, cui, score, model_version, model_hash`).
- `research/kg/MODEL_CARD.md` -- regenerated with this run's headline metric.
- `research/kg/figures/*.png` -- only when matplotlib is installed.

Expected SKIPPED lines on the classical venv (torch / RDKit / matplotlib
absent):
```
SKIPPED: GNN (torch not installed)
SKIPPED: structure (RDKit not installed)
SKIPPED: figures (matplotlib not installed)
```

## 3. Run individual stages (optional)

```powershell
research/kg/.venv/Scripts/python.exe research/kg/build_graph.py     # (re)build the KG
research/kg/.venv/Scripts/python.exe research/kg/ablations.py       # ablation matrix
research/kg/.venv/Scripts/python.exe research/kg/error_analysis.py  # breakdowns
research/kg/.venv/Scripts/python.exe research/kg/export.py          # scores + model card
```

## 4. Run the tests

```powershell
research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests
```

Fallback if pytest is unavailable -- each test file has an assert-based
`__main__` runner:

```powershell
research/kg/.venv/Scripts/python.exe research/kg/tests/test_export.py
```

## 5. Optional: figures (matplotlib)

Uncomment `matplotlib` in `requirements.txt` (or install it directly), then
rerun `run_all.py`. Figures are written to `research/kg/figures/`; without
matplotlib the figure stage is skipped and all tables are still produced.

## 6. Optional: structure fingerprints (RDKit + PubChem)

Structure features need (a) RDKit installed and (b) SMILES under
`data_raw/pubchem/`, keyed by the PubChem CID strings SIDER records per drug
(e.g. `CID100001983.smi`). `data_raw/pubchem/` does NOT exist in this
environment, so `build_graph.py` falls back to learned embeddings and records
the fallback flag in `provenance.json`. To enable structure features:

```powershell
research/kg/.venv/Scripts/python.exe -m pip install rdkit
# place <CID>.smi files under data_raw/pubchem/ , then rebuild:
research/kg/.venv/Scripts/python.exe research/kg/build_graph.py
```

## 7. Optional: the GNN stage (PyTorch + PyTorch Geometric)

The GNN is the ONLY part that needs torch, and it is a TWO-STEP install (a
plain `pip install torch-geometric` is NOT enough -- PyG needs companion
wheels matched to your exact torch build).

Step 1 -- CPU-only PyTorch from the official CPU index URL:
```powershell
research/kg/.venv/Scripts/python.exe -m pip install torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu
```
(Use a CUDA build instead only if you have a matching GPU and drivers.)

Step 2 -- PyTorch Geometric and its companion wheels from the PyG wheel index
that MATCHES your torch + platform:
```powershell
research/kg/.venv/Scripts/python.exe -m pip install torch-geometric==2.6.1
research/kg/.venv/Scripts/python.exe -m pip install pyg_lib torch_scatter torch_sparse torch_cluster torch_spline_conv -f https://data.pyg.org/whl/torch-2.5.1+cpu.html
```

With torch present, `run_all.py` detects it in the capability banner and runs
the GNN stage instead of skipping it.

## 8. What to do when torch / RDKit / matplotlib are absent

Nothing special -- that is the default, supported path. `run_all.py` detects
the missing dependency, prints the matching `SKIPPED:` line, and completes on
the classical stack. The classical baselines, ablations, error analysis, the
research-only score export, and the model card are all produced regardless.
