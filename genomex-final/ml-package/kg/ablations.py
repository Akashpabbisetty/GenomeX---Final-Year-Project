"""
research/kg/ablations.py
=================================================================
FEAT-003 -- Ablation study harness for drug->ADR association prediction.

Runs an ablation MATRIX over model/feature configurations and random seeds,
scoring each cell with AUROC on the DRUG-WISE cold-start test fold and a 95%
bootstrap confidence interval obtained by RESAMPLING HELD-OUT DRUGS (not
pairs). Results are written to research/kg/artifacts/ablation_results.parquet
with one row per (config, seed).

Configurations (the `configs` arg):
  classical baselines (always runnable on the venv):
    'popularity'  term-popularity prior
    'knn'         drug-similarity kNN (gene-set Jaccard basis)
    'logreg'      logistic regression on pair features
    'mf'          numpy matrix factorisation
  feature / structure ablations:
    '+genes'      kNN using the gene-Jaccard drug similarity (graph signal)
    '+tggates'    logreg augmented with TG-GATEs scalar features
    '+structure'  structure-fingerprint ablation -- REQUIRES RDKit +
                  data_raw/pubchem (both absent here) -> skipped
    'graph'       GNN message-passing cell -- REQUIRES torch/PyG -> skipped
    'non-graph'   best classical (mf) as the no-graph reference

DEPENDENCY-ABSENT HANDLING (critical): cells that need torch/PyG ('graph')
or RDKit/structure data ('+structure') must NOT fail the run. They are
recorded with status='skipped (dep absent)' and NaN metrics, so the harness
produces a complete matrix on the classical venv.

POSITIVE-UNLABELED (PU) CAVEAT: absent (drug, term) pairs are UNLABELED, not
confirmed negatives. Test-time "negatives" are the unlabeled pairs sampled as
a pseudo-negative background, so AUROC here is an optimistic upper bound (see
metrics.py / baselines.py docstrings).

Function-based module with `[kg.abl] ...` print-logging. Fixed base seed 42.

Run:
    research/kg/.venv/Scripts/python.exe research/kg/ablations.py
=================================================================
"""

import os

import numpy as np
import pandas as pd

import baselines as base
import metrics as mt
import splits as sp

SEED = 42
SKIPPED = "skipped (dep absent)"
_STRUCTURE_CONFIGS = {"+structure"}
_TORCH_CONFIGS = {"graph"}


def _artifacts_dir_default():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "artifacts"))


def _torch_available():
    try:
        import torch  # noqa: F401
        import torch_geometric  # noqa: F401
        return True
    except ImportError:
        return False


def _structure_available(artifacts_dir):
    """Structure cells need RDKit AND the structure fingerprint artifact
    (which only exists when data_raw/pubchem was present at build time)."""
    try:
        import rdkit  # noqa: F401
    except ImportError:
        return False
    return os.path.exists(os.path.join(artifacts_dir, "feat_drug_structure.parquet"))


# --------------------------------------------------------------------------
# data loading + test-fold assembly
# --------------------------------------------------------------------------

def _load_artifacts(artifacts_dir):
    """Load the FEAT-001 Parquet tables needed for the ablation matrix."""
    nodes_drug = pd.read_parquet(os.path.join(artifacts_dir, "nodes_drug.parquet"))
    nodes_term = pd.read_parquet(os.path.join(artifacts_dir, "nodes_term.parquet"))
    edges_dt = pd.read_parquet(os.path.join(artifacts_dir, "edges_drug_term.parquet"))
    edges_dg = pd.read_parquet(os.path.join(artifacts_dir, "edges_drug_gene.parquet"))
    tggates_path = os.path.join(artifacts_dir, "feat_drug_tggates.parquet")
    feat_tggates = pd.read_parquet(tggates_path) if os.path.exists(tggates_path) else None
    print(f"[kg.abl._load_artifacts] drugs={len(nodes_drug)} terms={len(nodes_term)} "
          f"drug-term={len(edges_dt)} drug-gene={len(edges_dg)} "
          f"tggates={'yes' if feat_tggates is not None else 'no'}")
    return nodes_drug, nodes_term, edges_dt, edges_dg, feat_tggates


def _build_test_items(test_drugs, edges_dt, n_terms, model, seed):
    """Build per-drug (y_true, y_score) items for the held-out TEST drugs.

    For each test drug we take its positive terms plus a PU pseudo-negative
    sample of the same count of unlabeled terms, score the pairs with `model`
    via baselines.predict_scores, and emit one (y_true, y_score) tuple per
    drug. These per-drug items are what bootstrap_ci resamples.
    """
    pos_by_drug = {}
    for d, t in edges_dt[["drug_index", "term_index"]].to_numpy():
        pos_by_drug.setdefault(int(d), set()).add(int(t))

    rng = np.random.default_rng(seed)
    items = []
    for d in sorted(int(x) for x in test_drugs):
        pos_terms = sorted(pos_by_drug.get(d, ()))
        if not pos_terms:
            continue
        n_pos = len(pos_terms)
        # PU pseudo-negative terms for this drug (unlabeled, never positive).
        neg_terms = set()
        attempts = 0
        while len(neg_terms) < n_pos and attempts < 50 * n_pos + 100:
            t = int(rng.integers(0, n_terms))
            attempts += 1
            if t not in pos_by_drug.get(d, ()) and t not in neg_terms:
                neg_terms.add(t)
        terms = pos_terms + sorted(neg_terms)
        y_true = np.array([1] * n_pos + [0] * len(neg_terms), dtype=int)
        pairs = np.array([[d, t] for t in terms], dtype=np.int64)
        y_score = base.predict_scores(model, pairs)
        items.append((y_true, y_score))
    return items


def _grouped_auroc(items):
    """AUROC over the pooled (y_true, y_score) across a list of per-drug
    items. Returns nan if the pool is single-class (bootstrap_ci filters
    nan draws)."""
    if not items:
        return float("nan")
    yt = np.concatenate([it[0] for it in items])
    ys = np.concatenate([it[1] for it in items])
    if len(np.unique(yt)) < 2:
        return float("nan")
    from sklearn.metrics import roc_auc_score
    return float(roc_auc_score(yt, ys))


# --------------------------------------------------------------------------
# per-config model fitting (classical configs only)
# --------------------------------------------------------------------------

def _fit_config(config, train_edges, nodes_drug, nodes_term, edges_dg,
                feat_tggates, n_drugs, n_terms, seed):
    """Fit the classical model for one ablation `config` on the cold-start
    training edges. Returns a baselines model dict (consumable by
    predict_scores). Dependency-gated configs are handled by the caller and
    never reach here.
    """
    train_np = train_edges[["drug_index", "term_index"]].to_numpy()

    if config in ("popularity",):
        return base.term_popularity_prior(train_np, n_terms)

    if config in ("knn", "+genes"):
        drug_gene = edges_dg[["drug_index", "gene_index"]].to_numpy()
        sim = base.gene_jaccard_similarity(drug_gene, n_drugs)
        return base.drug_similarity_knn(train_np, sim, n_terms, k=25)

    if config in ("logreg", "+tggates"):
        tp = base.term_popularity_prior(train_np, n_terms)
        if config == "+tggates" and feat_tggates is not None:
            tg = feat_tggates.set_index("drug_index")
            value_cols = [c for c in tg.columns if not c.endswith("_mask")]
            tg_values = tg[value_cols].fillna(0.0)

            def feats(d, t):
                row = (tg_values.loc[d].to_numpy()
                       if d in tg_values.index
                       else np.zeros(len(value_cols)))
                return np.concatenate([[float(d), float(t),
                                        tp["term_prior"][t]], row])
        else:
            def feats(d, t):
                return np.array([float(d), float(t), tp["term_prior"][t]])
        return base.logistic_regression_baseline(
            feats, train_np, n_drugs, n_terms, neg_ratio=1, seed=seed)

    if config in ("mf", "non-graph"):
        return base.matrix_factorisation(
            train_np, n_drugs, n_terms, dim=64, seed=seed, neg_ratio=1,
            epochs=30)

    raise ValueError(f"unhandled classical config: {config!r}")


# --------------------------------------------------------------------------
# the ablation matrix
# --------------------------------------------------------------------------

def run_ablation_matrix(configs=("popularity", "knn", "logreg", "mf",
                                 "+genes", "+structure", "+tggates",
                                 "graph", "non-graph"),
                        seeds=range(5), n_boot=1000,
                        artifacts_dir=None, out_path=None):
    """Run the ablation matrix and write ablation_results.parquet.

    For every (config, seed): build a drug-wise cold-start split at that seed,
    fit the config on the training edges, score the held-out TEST drugs, and
    record AUROC with a 95% bootstrap CI over the test DRUGS. Dependency-absent
    configs ('graph' needs torch/PyG; '+structure' needs RDKit + fingerprints)
    are recorded with status='skipped (dep absent)' and NaN metrics instead of
    failing. Returns the results DataFrame (also written to Parquet).

    Columns: config, seed, status, metric, point, ci_lo, ci_hi, n_test_drugs,
    n_boot.
    """
    artifacts_dir = artifacts_dir or _artifacts_dir_default()
    out_path = out_path or os.path.join(artifacts_dir, "ablation_results.parquet")
    seeds = list(seeds)
    configs = list(configs)

    torch_ok = _torch_available()
    structure_ok = _structure_available(artifacts_dir)
    print(f"[kg.abl.run_ablation_matrix] configs={configs} seeds={seeds} "
          f"n_boot={n_boot} torch={'yes' if torch_ok else 'no'} "
          f"structure={'yes' if structure_ok else 'no'}")

    nodes_drug, nodes_term, edges_dt, edges_dg, feat_tggates = \
        _load_artifacts(artifacts_dir)
    n_drugs = int(nodes_drug["drug_index"].max()) + 1
    n_terms = int(nodes_term["term_index"].max()) + 1

    # Drugs eligible for cold-start eval: those with at least one positive.
    labelled_drugs = np.sort(edges_dt["drug_index"].unique())

    rows = []
    for config in configs:
        skip_reason = None
        if config in _TORCH_CONFIGS and not torch_ok:
            skip_reason = "torch/torch_geometric not installed"
        elif config in _STRUCTURE_CONFIGS and not structure_ok:
            skip_reason = "RDKit / structure fingerprints absent"

        if skip_reason is not None:
            for seed in seeds:
                rows.append({
                    "config": config, "seed": seed, "status": SKIPPED,
                    "metric": "auroc", "point": np.nan, "ci_lo": np.nan,
                    "ci_hi": np.nan, "n_test_drugs": 0, "n_boot": n_boot,
                    "note": skip_reason,
                })
            print(f"[kg.abl] config={config!r} -> {SKIPPED} ({skip_reason})")
            continue

        for seed in seeds:
            split = sp.drug_wise_split(labelled_drugs, seed=seed)
            train_edges = sp.held_out_label_mask(edges_dt, split)
            model = _fit_config(config, train_edges, nodes_drug, nodes_term,
                                edges_dg, feat_tggates, n_drugs, n_terms, seed)
            items = _build_test_items(split["test"], edges_dt, n_terms, model,
                                      seed)
            point, lo, hi = mt.bootstrap_ci(_grouped_auroc, items,
                                            n_boot=n_boot, seed=seed)
            rows.append({
                "config": config, "seed": seed, "status": "ok",
                "metric": "auroc", "point": point, "ci_lo": lo, "ci_hi": hi,
                "n_test_drugs": len(items), "n_boot": n_boot, "note": "",
            })
            print(f"[kg.abl] config={config!r} seed={seed} auroc={point:.4f} "
                  f"ci=({lo:.4f},{hi:.4f}) test_drugs={len(items)}")

    results = pd.DataFrame(rows, columns=[
        "config", "seed", "status", "metric", "point", "ci_lo", "ci_hi",
        "n_test_drugs", "n_boot", "note"])
    os.makedirs(artifacts_dir, exist_ok=True)
    results.to_parquet(out_path, index=False)
    n_ok = int((results["status"] == "ok").sum())
    n_skip = int((results["status"] == SKIPPED).sum())
    print(f"[kg.abl.run_ablation_matrix] wrote {out_path} rows={len(results)} "
          f"ok={n_ok} skipped={n_skip}")
    return results


def main():
    """Run the full matrix with a reduced bootstrap count for a quick smoke."""
    run_ablation_matrix(n_boot=200)


if __name__ == "__main__":
    main()
