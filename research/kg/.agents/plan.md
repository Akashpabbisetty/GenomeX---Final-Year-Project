# Implementation Plan — KG drug→ADR association prediction (`research/kg/`)

This plan builds the primary research experiment from `.kiro/specs/kg-adr-prediction/`.
All new code lives under `research/kg/`. It must NOT touch `engine/`, `frontend/`, or
`research/models/`. Model output is research-only and must never feed the deterministic
engine or set a rule category (per `.kiro/steering/product.md`).

> This file is the fallback plan for the implement-and-review loop. When the workflow is
> restructured into FEAT artifacts (see `research/kg/.agents/task-kg-adr/`), those artifacts
> are the authoritative per-feature contract and this file is the human-readable overview.

---

## Observed data schemas (verified by reading real files — do NOT re-assume)

### SIDER per-drug side effects — `data/adverse/drug/<drug_id>.json`
~1344 files, one per drug. Example (`acetaminophen.json`):
```json
{"drug":"acetaminophen","siderNames":["acetaminophen"],"cids":["CID100001983"],
 "note":null,"n":164,
 "cols":["cui","freq","lo","hi","placeboHi","rank"],
 "effects":[["C0151828","14.7%",0.1474,0.1474,null,0.1474], ...]}
```
- `drug`: canonical drug id string (matches filename stem and `data/drugs.json` ids).
- `cids`: PubChem CID strings like `"CID100001983"` (prefix `CID1` + zero-padded number). Used later to join optional PubChem SMILES.
- `effects`: list of 6-tuples in the order given by `cols`:
  `[cui, freq_str, lo, hi, placeboHi, rank]`.
  - `cui`: UMLS CUI term id (e.g. `C0151828`) — this is the MedDRA PT term node id. Join to `data/adverse/terms.json` for the human label.
  - `freq_str`: free-text frequency (`"14.7%"`, `"common"`, `"rare"`, `"postmarketing"`, `"very rare"`, `null`). Present for ~41% of pairs.
  - `lo`,`hi`: numeric frequency bounds (floats or `null`). `placeboHi`: float or `null`.
  - `rank`: float used only for sorting; `0` when no frequency.
- **LABEL SEMANTICS (critical, PU-learning):** a `(drug, cui)` pair present in `effects` is a POSITIVE label. A pair NOT present is UNLABELED, never a confirmed negative. `freq`/`lo`/`hi` are the secondary ordinal/regression target and MUST NOT enter the primary binary claim.

### SIDER index — `data/adverse/index.json`
`{"schema":"adverse/1","source":"SIDER 4.1","drugs":{<drug_id>:<n_effects>},"terms":4251,"pairs":140677,"pairsWithFrequency":58548,"frequencyNote":...}`
- `drugs`: dict drug_id → count of effect terms. Authoritative drug list + positive-count per drug (1344 drugs).
- Use `terms`/`pairs` totals to assert the graph build matches expected counts in provenance.

### SIDER terms — `data/adverse/terms.json`
Flat dict `{ "C0000737": "Abdominal pain", ... }` mapping cui → human label (4251 terms). This is the term-node vocabulary + display labels.

### SIDER by-term shards — `data/adverse/by_term/*.json`
64 files (e.g. `b00.json`). Each is a dict `cui → [[drug_id, freq_str, rank], ...]`. This is a transpose of the per-drug data (same information). **Canonical source for building label edges is the per-drug files**; by_term is only for term-centric lookups/validation.

### ClinPGx guidelines — `data/guidelines/index.json`
`{"schema":"guidelines/1","attribution":"Contains data from ClinPGx ... CC BY-SA 4.0 ...","created":...,"guidelines":[ ... ]}`
217 guideline objects. Each guideline:
```json
{"id":"PA166104933","name":"...","source":"CPIC","version":58,"url":"...",
 "drugs":[{"name":"azathioprine","id":"PA448515","drugId":"azathioprine"}],
 "genes":["NUDT15","TPMT"],
 "created":"...","lastUpdated":"...","literature":[...],"flags":{...},"summary":"..."}
```
- **There is NO precomputed drug→gene index.** Build drug–gene edges by iterating `guidelines`, and for each guideline forming the cross product of `drugs[].drugId` × `genes[]`.
- `drugs[].drugId` is the drug node id (matches SIDER drug ids where overlapping).
- `genes[]` are gene SYMBOLS (e.g. `CYP2C19`, `TPMT`, `HLA-B`). 41 unique gene symbols, 208 unique drugs across guidelines.
- Keep the attribution string in provenance (CC BY-SA requirement).

### Gene catalog — `data/gene_catalog.json`
`{"schema":"genes-catalog/1","attribution":"Contains data from ClinPGx (CC BY-SA 4.0)...","genes":[{"symbol":"ABCB1","name":"...","clinpgxId":"PA267","hgncId":"...","ncbiGeneId":"...","ensemblId":"...","isVip":bool,"hasCpicGuideline":bool,"hasVariantAnnotation":bool,"chromosome":"chr7"}, ...]}`
41 genes; `symbol` matches the guideline `genes[]` symbols exactly → **gene nodes are keyed by `symbol`.** `data/genes.json` (21 entries, HLA alleles + metabolizer phenotypes) is the engine's gene vocabulary, a different granularity — do NOT use it for KG gene nodes; use `gene_catalog.json`.

### Open TG-GATEs — `data/tggates/index.json` and `data/tggates/compound/<drug>.json`
Index: `{"schema":"tggates/1","compounds":{ <drug_id>: {...}, ... }}` — **127 compounds** (task said ~122; the real count is 127). Each index entry:
```json
{"compound":"acetaminophen","match":"exact","inVivo":true,"animals":160,
 "liverEnzymeSignal":false,"nFlaggedGroups":0,
 "maxALTfold":1.378,"maxASTfold":1.484,"inVitroHuman":24,"inVitroRat":24}
```
- Keyed by drug node id. `match` ∈ {`exact`,`synonym`,`curated-addition`}.
- `maxALTfold`/`maxASTfold` can be `null` (e.g. in-vitro-only compounds like `alpidem`).
- **TG-GATEs node features used for the graph (scalar, from the index):**
  `maxALTfold`, `maxASTfold`, `inVitroHuman`, `inVitroRat`, `animals`, `liverEnzymeSignal`(bool→0/1), `nFlaggedGroups`. Each needs a **missing-mask** column because only 127/1344 drugs have TG-GATEs and some folds are `null`.
- Per-compound files (`compound/<drug>.json`) carry detailed `groups[].ep.{ALT,AST,ALP,GGT,TBIL,LIVER_REL}.fold` fold-changes at dose/period levels, plus `summary`. These are the OPTIONAL richer features; the index scalars are the minimal set. Plan uses the index scalars for v1 and documents the per-compound file as an extension point.
- Note: rat preclinical data — a documented limitation, not human outcomes.

### Supporting vocab/provenance
- `data/drugs.json`: `{"schema":"drugs/1","drugs":[{"id","name","class","aliases","sources":{"sider":bool,"guidelines":int}}, ...]}` — drug display names/classes + source provenance. `class` is often `null` (relevant for error-analysis by drug class — many will be "unknown").
- `data/sources.json`: provenance/licences (read for licence strings to cite in the model card).
- `data/vocab.json`: engine vocab (indications, allergy classes) — not needed for the KG.

### PubChem SMILES — `data_raw/pubchem/`
**Does NOT exist** (verified: neither `data_raw/` nor `data_raw/pubchem/` is present). Task 1 (download) is explicitly out of scope. Therefore structure/RDKit fingerprint features MUST be optional: a loader stub that reads `data_raw/pubchem/` if present (keyed by the `cids` from SIDER drug files) and otherwise falls back to learned embeddings, printing that it did so.

### Environment (verified from the workflow's venv at `research/kg/.venv`)
Installed: `scikit-learn 1.9.1`, `pandas 3.0.6`, `pyarrow 26.0.0`, `numpy 2.5.4`, `scipy 1.18.1`, `duckdb 1.5.6`.
NOT installed: `torch`, `torch-geometric`, `rdkit`, `matplotlib`.
Consequences:
- GNN (`gnn.py`) and structure fingerprints (`build_graph.py`) must LAZY-import torch/PyG/RDKit and degrade gracefully with a clear install message. The classical pipeline must run fully on the current venv.
- `run_all.py` must skip GNN/structure if torch/RDKit absent and SAY so.
- Figures: `matplotlib` is absent. `run_all.py`/`metrics.py` must write tables (CSV/Parquet/Markdown) always, and only attempt PNG figures when matplotlib is importable, otherwise skip-and-say. (Alternatively `requirements.txt` lists matplotlib; the fallback keeps the pipeline runnable without it.)

### Schema ambiguities flagged
- **Drug id reconciliation:** SIDER drug ids, guideline `drugId`s, and TG-GATEs keys mostly coincide but are independently sourced. Build the node set as the UNION, keyed by the exact id strings; record per-node source flags (`in_sider`, `in_guideline`, `in_tggates`). Any guideline/TG-GATEs id with no SIDER entry is still a drug node but has no label edges (and is excluded from drug-wise eval folds that require positives). Do NOT invent a mapping — join on exact string id and record unmatched ids in provenance.
- TG-GATEs count is 127, not the ~122 the brief mentioned; use the real count and note it.
- `data/genes.json` vs `gene_catalog.json` granularity differs — KG uses `gene_catalog.json` symbols only.

---

## Planned Parquet artifact schemas (written to `research/kg/artifacts/`)

- `nodes_drug.parquet`: `drug_id:str, drug_index:int, name:str, drug_class:str|null, in_sider:bool, in_guideline:bool, in_tggates:bool, n_positive_terms:int`
- `nodes_term.parquet`: `cui:str, term_index:int, label:str, n_drugs:int (positive count)`
- `nodes_gene.parquet`: `symbol:str, gene_index:int, name:str, is_vip:bool, has_cpic:bool`
- `edges_drug_term.parquet` (label target, positives only): `drug_index:int, term_index:int, freq_str:str|null, freq_lo:float|null, freq_hi:float|null, rank:float`
- `edges_drug_gene.parquet` (guideline): `drug_index:int, gene_index:int, source:str (CPIC/DPWG/…), guideline_id:str`
- `edges_drug_drug_knn.parquet` (optional similarity): `drug_index_i:int, drug_index_j:int, weight:float, basis:str ("tanimoto"|"gene_jaccard")`
- `feat_drug_tggates.parquet`: `drug_index:int, max_alt_fold, max_ast_fold, in_vitro_human, in_vitro_rat, animals, liver_enzyme_signal, n_flagged_groups` + one `*_mask` boolean per feature column
- `feat_drug_structure.parquet` (only when PubChem present): `drug_index:int, fp_0..fp_{N-1}:uint8` (RDKit Morgan bits) OR absent file + a flag in provenance when falling back to learned embeddings
- `provenance.json`: counts per table, SHA-256 of each input file consumed and each output Parquet, licence/attribution strings (ClinPGx CC BY-SA, SIDER, TG-GATEs), the structure-fallback flag, unmatched-id lists, library versions, fixed seed.

---

## Module-by-module function signatures (function-based, `[module.func] ...` print logging)

### `research/kg/build_graph.py`
- `load_sider(drug_dir, index_path) -> (drug_records: dict, term_labels: dict)` — reads per-drug jsons + index + terms.
- `load_guideline_edges(index_path) -> list[(drug_id, gene_symbol, source, guideline_id)]`
- `load_gene_catalog(path) -> dict[symbol -> meta]`
- `load_tggates(index_path) -> dict[drug_id -> features]` (index scalars + mask)
- `load_structure_fingerprints(cids_by_drug, raw_dir="data_raw/pubchem", n_bits=2048) -> (dict|None, used_fallback: bool)` — RDKit lazy import; returns None + True when dir absent or RDKit missing.
- `build_node_tables(...) -> (nodes_drug_df, nodes_term_df, nodes_gene_df)` — assigns contiguous indices.
- `build_edge_tables(...) -> (dt_df, dg_df)`
- `build_knn_edges(drug_feature_matrix, k=10, basis) -> dd_df` (optional)
- `sha256_file(path) -> str`
- `write_artifacts(tables, out_dir="research/kg/artifacts") -> provenance: dict` — writes Parquet, prints counts, writes `provenance.json`.
- `main(seed=42)` / `if __name__ == "__main__"`.
- Verify: `research/kg/.venv/Scripts/python.exe research/kg/build_graph.py` prints node/edge counts matching index totals (drugs=1344, terms=4251, label pairs≈140677) and writes all Parquet + provenance; non-zero exit on count mismatch.

### `research/kg/splits.py`
- `drug_wise_split(drug_indices, seed=42, val_frac=0.1, test_frac=0.2) -> {train,val,test}` — cold-start: held-out drugs contribute NO label edges to training.
- `term_wise_split(term_indices, seed=42, ...) -> {...}`
- `random_pair_split(pairs, seed=42, ...) -> {...}` — LABELED "optimistic", not for claims.
- `held_out_label_mask(edges_df, split) -> train_edges_df` — drops label edges touching held-out drugs.
- `main()` smoke print.
- Test `research/kg/tests/test_splits.py`: asserts zero drug-id overlap between train and test; asserts no held-out drug appears as an endpoint of any training label edge.
- Verify: `research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests/test_splits.py` → all pass. (If pytest absent, provide a `if __name__=="__main__"` assert-based runner invoked directly.)

### `research/kg/baselines.py` (scikit-learn / numpy only)
- `term_popularity_prior(train_edges, n_terms) -> scores`
- `drug_similarity_knn(train_edges, drug_sim, k=25) -> scores` — `drug_sim` from structure Tanimoto when present else gene-set Jaccard.
- `logistic_regression_baseline(features, train_edges, ...) -> model, scores`
- `matrix_factorisation(train_edges, n_drugs, n_terms, dim=64, seed=42) -> (D, T)` — numpy ALS/SGD, documented negatives.
- `predict_scores(model, pairs) -> np.ndarray`
- Verify: `research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests/test_baselines.py` → each baseline returns finite scores of expected shape on a small synthetic graph.

### `research/kg/metrics.py` (scikit-learn + numpy only)
- `auroc(y_true, y_score)`, `auprc(y_true, y_score)`
- `precision_at_k_per_drug(y_true_by_drug, y_score_by_drug, k) -> mean, per_drug`
- `expected_calibration_error(y_true, y_score, n_bins=10) -> (ece, reliability_table)`
- `bootstrap_ci(metric_fn, grouped_by_drug, n_boot=1000, seed=42, alpha=0.05) -> (point, lo, hi)` — resample held-out DRUGS.
- Verify: `pytest research/kg/tests/test_metrics.py` → AUROC on separable toy = 1.0; ECE of perfectly-calibrated toy ≈ 0; CI brackets point estimate.

### `research/kg/gnn.py` (torch/PyG LAZY/optional)
- Module-level: NO top-level torch import. `_require_torch()` helper raises a clear install message pointing to `requirements.txt` + the separate PyG wheel step.
- `build_hetero_data(artifacts_dir) -> HeteroData` (lazy import inside).
- `class HeteroLinkPredictor` (defined inside a factory function `make_model(...)` to keep import clean) — message passing + dot-product decoder.
- `sample_negatives(pos_edges, n_drugs, n_terms, ratio=1, seed=42) -> neg_edges` — documented PU negative sampling (sampled from unlabeled).
- `train_gnn(data, splits, epochs, patience, seed=42) -> (model, history)` — BCE, early stopping on drug-wise val.
- `score_all_pairs(model, data) -> scores`
- Verify: `research/kg/.venv/Scripts/python.exe -c "import research.kg.gnn"` imports cleanly WITHOUT torch installed; calling `train_gnn` without torch raises the clear install error (covered by `tests/test_gnn_import.py`).

### `research/kg/ablations.py`
- `run_ablation_matrix(configs=[+genes,+structure,+tggates,graph,non-graph], seeds=range(5), n_boot=1000) -> results_df` — each cell: point + 95% bootstrap CI over held-out drugs. Skips structure/GNN cells gracefully if deps absent and records "skipped (dep absent)".
- Verify: produces `research/kg/artifacts/ablation_results.parquet` with a row per (config, seed) and CI columns; `pytest tests/test_ablations.py` checks shape + that skipped cells are labeled.

### `research/kg/error_analysis.py`
- `by_term_frequency(scores, edges, terms) -> df`
- `by_drug_class(scores, edges, drugs_meta) -> df` (classes often null → "unknown" bucket)
- `by_label_sparsity(scores, edges) -> df`
- Verify: writes `research/kg/artifacts/error_analysis_*.parquet`; `pytest tests/test_error_analysis.py` checks grouping sums reconcile to totals.

### `research/kg/export.py`
- `export_scores(scores, model_version, graph_hash, out="data/model/assoc_scores.parquet")` — columns `drug_id, cui, score, model_version, model_hash`. RESEARCH ONLY; never consumed by engine.
- `write_model_card(path="research/kg/MODEL_CARD.md", metrics, licences)` — states PU caveat (absent = unlabeled, not negative), licences (ClinPGx CC BY-SA, SIDER, TG-GATEs non-commercial/share-alike), intended use (research only, never clinical, never overrides rules), rat-data limitation.
- Verify: `research/kg/.venv/Scripts/python.exe research/kg/export.py` writes the Parquet with the version/hash columns and the model card contains the PU + licence + "never overrides rules" statements (asserted by `tests/test_export.py`).

### `research/kg/run_all.py`
- `main()` runs build_graph → splits → baselines → metrics → (GNN if torch) → ablations → error_analysis → export, writing tables + figures to `research/kg/figures/` (figures only if matplotlib present). Prints a capability banner (which optional deps are present/absent and what was skipped).
- Verify: `research/kg/.venv/Scripts/python.exe research/kg/run_all.py` completes end-to-end on the classical stack, printing explicit "SKIPPED: GNN (torch not installed)" / "SKIPPED: structure (RDKit not installed)" lines and producing baseline tables + `assoc_scores.parquet`.

### `research/kg/requirements.txt`
Pin `torch`, `torch-geometric`, `scikit-learn`, `pandas`, `pyarrow`, `numpy`, `scipy`, `duckdb`, optional `rdkit`, optional `matplotlib`, with versions, plus a comment on the separate PyG wheel install step and the CPU-only torch index URL.

---

## Documentation (in `research/kg/`)
- `METHODS.md` — task definition, graph schema, why cold-start splits, baselines + GNN described precisely, PU-learning caveat, metrics + CIs, ablation design, honest limitations (SIDER 4.1 snapshot, labels from drug labels not patient outcomes, no patient cohort, rat TG-GATEs data). Use `[cite: verify]` placeholders — do NOT invent citations.
- `PROCESS.md` — PowerShell run guide: create venv, `pip install -r requirements.txt`, separate PyG wheel step, CPU-only torch path, where PubChem data goes (`data_raw/pubchem/`), what each command does, expected outputs, what to do if torch/RDKit absent.
- `README.md` — short orientation, the one command (`python run_all.py`), pointers to METHODS.md + PROCESS.md.

---

## Ordered build sequence (dependency order)
1. `build_graph.py` + `provenance.json` (foundation; everything reads artifacts).
2. `splits.py` + split unit test (needs node/edge tables).
3. `metrics.py` (pure; needed by baselines/ablations/error analysis).
4. `baselines.py` (needs graph + splits + metrics).
5. `gnn.py` (needs graph + splits; lazy torch).
6. `ablations.py` (needs baselines + gnn + metrics).
7. `error_analysis.py` (needs scores + graph).
8. `export.py` (needs scores; writes `data/model/` + model card).
9. `run_all.py` (orchestrates all; graceful skips).
10. `requirements.txt`, `METHODS.md`, `PROCESS.md`, `README.md`.

Each step must leave the classical pipeline runnable on the current venv (torch/RDKit/matplotlib optional).

11. **Mirror to portable location.** After the package is built and verified, copy the standalone
    source files + `tests/` from `research/kg/` into `genomex-final/ml-package/kg/` (folder exists),
    and add `SETUP.md` there (same content as `PROCESS.md`). This is per a user-routed instruction
    that `genomex-final/ml-package/kg/` is the folder they will copy to their ML machine. Do NOT copy
    `.venv/`, `artifacts/`, `figures/`, or `.agents/`. `research/kg/` stays the canonical, verifiable
    build location — the mirror is an additional copy, nothing is relocated.
