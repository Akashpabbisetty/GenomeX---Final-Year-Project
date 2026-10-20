"""
research/kg/run_all.py
=================================================================
FEAT-004 -- One-command orchestration of the drug->ADR research pipeline.

Runs, in dependency order:
    build_graph -> splits -> metrics -> baselines -> (GNN only if torch) ->
    ablations -> error_analysis -> export

It is designed to run END-TO-END on the CLASSICAL venv, which has NO torch,
RDKit, or matplotlib. Optional stages degrade gracefully:
  - GNN:        SKIPPED when torch / torch_geometric is absent.
  - structure:  SKIPPED when RDKit (and data_raw/pubchem fingerprints) absent.
  - figures:    SKIPPED when matplotlib is absent (tables are always written).

A capability banner is printed at the start listing which optional
dependencies are present or absent, and each skipped stage prints an explicit
`SKIPPED: ...` line so a reader knows exactly what did and did not run.

Always produced on the classical venv:
  - research/kg/artifacts/*.parquet (graph + ablation + error-analysis tables)
  - data/model/assoc_scores.parquet (research-only association scores)
  - research/kg/MODEL_CARD.md

Function-based module with `[kg.run] ...` print-logging. Fixed seed 42.

Run:
    research/kg/.venv/Scripts/python.exe research/kg/run_all.py
=================================================================
"""

import os
import sys

import numpy as np
import pandas as pd

SEED = 42

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))
_ARTIFACTS_DIR = os.path.join(_THIS_DIR, "artifacts")
_FIGURES_DIR = os.path.join(_THIS_DIR, "figures")

# Make the sibling modules importable regardless of cwd (same convention the
# tests and other modules use).
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)


# --------------------------------------------------------------------------
# capability detection
# --------------------------------------------------------------------------

def _torch_available():
    try:
        import torch  # noqa: F401
        import torch_geometric  # noqa: F401
        return True
    except ImportError:
        return False


def _rdkit_available():
    try:
        import rdkit  # noqa: F401
        return True
    except ImportError:
        return False


def _matplotlib_available():
    try:
        import matplotlib  # noqa: F401
        return True
    except ImportError:
        return False


def _structure_available():
    """Structure cells need RDKit AND the structure fingerprint artifact
    (only built when data_raw/pubchem was present)."""
    return _rdkit_available() and os.path.exists(
        os.path.join(_ARTIFACTS_DIR, "feat_drug_structure.parquet"))


def capability_banner():
    """Print and return the optional-dependency capability map."""
    caps = {
        "torch": _torch_available(),
        "rdkit": _rdkit_available(),
        "structure_fingerprints": _structure_available(),
        "matplotlib": _matplotlib_available(),
    }
    print("=" * 70)
    print("[kg.run] CAPABILITY BANNER (optional dependencies)")
    for name, present in caps.items():
        print(f"[kg.run]   {name:<24} {'PRESENT' if present else 'ABSENT'}")
    print("[kg.run] The classical pipeline runs fully without any of these; "
          "absent stages are SKIPPED and reported below.")
    print("=" * 70)
    return caps


# --------------------------------------------------------------------------
# pipeline stages
# --------------------------------------------------------------------------

def _run_build_graph():
    print("[kg.run] STAGE build_graph")
    import build_graph as bg
    bg.main(seed=SEED)


def _load_artifacts():
    nodes_drug = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "nodes_drug.parquet"))
    nodes_term = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "nodes_term.parquet"))
    edges_dt = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "edges_drug_term.parquet"))
    edges_dg = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "edges_drug_gene.parquet"))
    return nodes_drug, nodes_term, edges_dt, edges_dg


def _run_splits_and_baseline(nodes_drug, nodes_term, edges_dt, edges_dg):
    """Build a drug-wise cold-start split, fit the classical baselines on the
    training edges, and score every positive pair. Returns (scores_df,
    model_version) for export + a short metrics summary for the model card.
    """
    print("[kg.run] STAGE splits + metrics + baselines")
    import splits as sp
    import baselines as base
    import metrics as mt

    n_drugs = int(nodes_drug["drug_index"].max()) + 1
    n_terms = int(nodes_term["term_index"].max()) + 1
    labelled_drugs = np.sort(edges_dt["drug_index"].unique())

    split = sp.drug_wise_split(labelled_drugs, seed=SEED)
    train_edges = sp.held_out_label_mask(edges_dt, split)
    train_np = train_edges[["drug_index", "term_index"]].to_numpy()

    # Matrix factorisation is the headline classical model used for export.
    model = base.matrix_factorisation(train_np, n_drugs, n_terms, dim=64,
                                      seed=SEED, neg_ratio=1, epochs=30)
    model_version = "matrix_factorisation_v1"

    # Headline metric: AUROC with a 95% bootstrap CI over held-out drugs.
    metrics_summary = _eval_summary(split, edges_dt, n_terms, model, base, mt)

    # Score EVERY positive pair for the export (research signal over the KG).
    all_pairs = edges_dt[["drug_index", "term_index"]].to_numpy()
    raw_scores = base.predict_scores(model, all_pairs)
    drug_id_by_index = dict(zip(nodes_drug["drug_index"], nodes_drug["drug_id"]))
    cui_by_index = dict(zip(nodes_term["term_index"], nodes_term["cui"]))
    scores_df = pd.DataFrame({
        "drug_id": [drug_id_by_index[int(d)] for d, _ in all_pairs],
        "cui": [cui_by_index[int(t)] for _, t in all_pairs],
        "score": np.asarray(raw_scores, dtype=float),
    })
    return scores_df, model_version, metrics_summary


def _eval_summary(split, edges_dt, n_terms, model, base, mt):
    """Per-drug AUROC with a bootstrap CI over held-out TEST drugs (small
    bootstrap for speed in the orchestration run)."""
    pos_by_drug = {}
    for d, t in edges_dt[["drug_index", "term_index"]].to_numpy():
        pos_by_drug.setdefault(int(d), set()).add(int(t))
    rng = np.random.default_rng(SEED)
    items = []
    for d in sorted(int(x) for x in split["test"]):
        pos_terms = sorted(pos_by_drug.get(d, ()))
        if not pos_terms:
            continue
        n_pos = len(pos_terms)
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

    def grouped_auroc(sample):
        if not sample:
            return float("nan")
        yt = np.concatenate([s[0] for s in sample])
        ys = np.concatenate([s[1] for s in sample])
        return mt.auroc(yt, ys)

    point, lo, hi = mt.bootstrap_ci(grouped_auroc, items, n_boot=200, seed=SEED)
    return {
        "AUROC (drug-wise cold-start, matrix factorisation)":
            f"{point:.4f} (95% CI {lo:.4f}-{hi:.4f}; "
            f"{len(items)} held-out drugs; PU, optimistic)",
    }


def _run_gnn(caps):
    if caps["torch"]:
        print("[kg.run] STAGE gnn (torch present) -- training GNN")
        import gnn
        import splits as sp
        data = gnn.build_hetero_data(_ARTIFACTS_DIR)
        edges_dt = pd.read_parquet(
            os.path.join(_ARTIFACTS_DIR, "edges_drug_term.parquet"))
        labelled = np.sort(edges_dt["drug_index"].unique())
        split = sp.drug_wise_split(labelled, seed=SEED)
        gnn.train_gnn(data, split, seed=SEED)
        return True
    print("SKIPPED: GNN (torch not installed)")
    return False


def _run_ablations():
    print("[kg.run] STAGE ablations")
    import ablations as abl
    # Small bootstrap keeps the orchestration run quick; the full study uses
    # the module's defaults.
    results = abl.run_ablation_matrix(n_boot=200)
    skipped = results[results["status"].str.startswith("skipped")]
    for cfg in sorted(skipped["config"].unique()):
        print(f"[kg.run]   ablation config {cfg!r} -> skipped (dep absent)")
    return results


def _run_error_analysis(scores_df, nodes_drug, nodes_term, edges_dt):
    print("[kg.run] STAGE error_analysis")
    import error_analysis as err
    # Row-align the export scores back to the edge order for the breakdowns.
    key = {(r.drug_id, r.cui): r.score for r in scores_df.itertuples(index=False)}
    drug_id_by_index = dict(zip(nodes_drug["drug_index"], nodes_drug["drug_id"]))
    cui_by_index = dict(zip(nodes_term["term_index"], nodes_term["cui"]))
    aligned = np.array([
        key.get((drug_id_by_index[int(d)], cui_by_index[int(t)]), np.nan)
        for d, t in edges_dt[["drug_index", "term_index"]].to_numpy()
    ], dtype=float)
    err.by_term_frequency(aligned, edges_dt, nodes_term, out_dir=_ARTIFACTS_DIR)
    err.by_drug_class(aligned, edges_dt, nodes_drug, out_dir=_ARTIFACTS_DIR)
    err.by_label_sparsity(aligned, edges_dt, out_dir=_ARTIFACTS_DIR)


def _run_figures(caps, ablation_results):
    if not caps["matplotlib"]:
        print("SKIPPED: figures (matplotlib not installed)")
        return False
    print("[kg.run] STAGE figures (matplotlib present)")
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    os.makedirs(_FIGURES_DIR, exist_ok=True)
    ok = ablation_results[ablation_results["status"] == "ok"]
    if len(ok):
        agg = ok.groupby("config")["point"].mean().sort_values()
        fig, ax = plt.subplots(figsize=(8, 4))
        agg.plot.barh(ax=ax)
        ax.set_xlabel("mean AUROC (drug-wise, PU optimistic)")
        ax.set_title("Ablation configs -- mean AUROC")
        fig.tight_layout()
        out = os.path.join(_FIGURES_DIR, "ablation_auroc.png")
        fig.savefig(out, dpi=120)
        plt.close(fig)
        print(f"[kg.run] wrote figure {out}")
    return True


def _run_export(scores_df, model_version):
    print("[kg.run] STAGE export")
    import export as exp
    graph_hash = exp._graph_hash()
    out_path, mhash = exp.export_scores(scores_df, model_version, graph_hash)
    return out_path, mhash, graph_hash


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------

def main():
    print(f"[kg.run] start run_all seed={SEED} repo_root={REPO_ROOT}")
    caps = capability_banner()

    _run_build_graph()
    nodes_drug, nodes_term, edges_dt, edges_dg = _load_artifacts()

    scores_df, model_version, metrics_summary = _run_splits_and_baseline(
        nodes_drug, nodes_term, edges_dt, edges_dg)

    _run_gnn(caps)
    if not caps["structure_fingerprints"]:
        print("SKIPPED: structure (RDKit not installed)")

    ablation_results = _run_ablations()
    _run_error_analysis(scores_df, nodes_drug, nodes_term, edges_dt)
    _run_figures(caps, ablation_results)

    out_path, mhash, graph_hash = _run_export(scores_df, model_version)

    # Model card with the headline metric from this run.
    import export as exp
    metrics_summary["model_version"] = model_version
    metrics_summary["model_hash"] = mhash
    metrics_summary["kg_graph_hash"] = graph_hash
    exp.write_model_card(metrics=metrics_summary)

    print("=" * 70)
    print("[kg.run] PIPELINE COMPLETE")
    print(f"[kg.run]   scores:     {os.path.relpath(out_path, REPO_ROOT)}")
    print(f"[kg.run]   model card: {os.path.relpath(exp.DEFAULT_MODEL_CARD, REPO_ROOT)}")
    print("[kg.run]   artifacts:  research/kg/artifacts/*.parquet")
    skipped = []
    if not caps["torch"]:
        skipped.append("GNN (torch not installed)")
    if not caps["structure_fingerprints"]:
        skipped.append("structure (RDKit not installed)")
    if not caps["matplotlib"]:
        skipped.append("figures (matplotlib not installed)")
    print(f"[kg.run]   SKIPPED:    {', '.join(skipped) if skipped else 'none'}")
    print("=" * 70)


if __name__ == "__main__":
    main()
