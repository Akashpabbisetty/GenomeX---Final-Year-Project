"""
research/kg/error_analysis.py
=================================================================
FEAT-003 -- Error-analysis breakdowns for the drug->ADR predictions.

Slices held-out performance along three axes so failures are attributable
rather than hidden in a single aggregate:
  - by_term_frequency : group positive (drug, term) pairs by the SIDER
                        frequency band (freq_str), reporting mean score +
                        counts per band -- are rare side effects harder?
  - by_drug_class     : group by drug class (nodes_drug.drug_class), bucketing
                        null/missing classes as 'unknown' -- which classes do
                        worst?
  - by_label_sparsity : group drugs by how many positive terms they carry
                        (sparse-label vs well-annotated drugs).

Each writes research/kg/artifacts/error_analysis_<axis>.parquet. The grouped
counts RECONCILE to the input totals (asserted by the tests): summing the
per-group `n` equals the number of scored positive pairs.

POSITIVE-UNLABELED (PU) CAVEAT: these breakdowns summarise scores over the
POSITIVE pairs (and, where noted, sampled unlabeled pairs); absent pairs are
unlabeled, not confirmed negatives (see metrics.py / baselines.py).

`scores` is accepted as EITHER a dict {(drug_index, term_index) -> score} OR
a 1d array aligned to the row order of the `edges` frame passed in -- so this
module works with any upstream scorer (baselines or GNN) without importing
torch.

Function-based module with `[kg.err] ...` print-logging. Fixed seed 42.

Run:
    research/kg/.venv/Scripts/python.exe research/kg/error_analysis.py
=================================================================
"""

import os

import numpy as np
import pandas as pd

SEED = 42


def _artifacts_dir_default():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "artifacts"))


def _score_for_rows(scores, edges):
    """Resolve a per-row score vector aligned to `edges` from either a dict
    keyed by (drug_index, term_index) or an array aligned to edges' rows."""
    if isinstance(scores, dict):
        return np.array([
            float(scores.get((int(d), int(t)), np.nan))
            for d, t in edges[["drug_index", "term_index"]].to_numpy()
        ], dtype=float)
    arr = np.asarray(scores, dtype=float)
    if len(arr) != len(edges):
        raise ValueError(
            f"score array length {len(arr)} != n_edges {len(edges)}; pass a "
            "dict keyed by (drug_index,term_index) if not row-aligned")
    return arr


def _freq_band(freq_str):
    """Map a SIDER freq_str to a coarse band for grouping. Numeric percentages
    bucket into common/infrequent/rare; textual terms pass through; missing
    frequency becomes 'unknown'."""
    if freq_str is None or (isinstance(freq_str, float) and np.isnan(freq_str)):
        return "unknown"
    s = str(freq_str).strip().lower()
    if s == "" or s == "none" or s == "nan":
        return "unknown"
    if s.endswith("%"):
        try:
            pct = float(s[:-1])
        except ValueError:
            return s
        if pct >= 10.0:
            return "common (>=10%)"
        if pct >= 1.0:
            return "infrequent (1-10%)"
        return "rare (<1%)"
    return s  # textual bands: 'common', 'rare', 'postmarketing', ...


def by_term_frequency(scores, edges, terms, out_dir=None):
    """Breakdown of mean score over positive pairs by SIDER frequency band.

    `edges` is the positive drug-term edge frame (needs columns drug_index,
    term_index, freq_str); `terms` is the nodes_term frame (cui/term_index/
    label) used to annotate counts. Writes error_analysis_term_frequency.parquet
    and returns the grouping DataFrame. The per-band `n` sums to len(edges).
    """
    out_dir = out_dir or _artifacts_dir_default()
    s = _score_for_rows(scores, edges)
    df = edges[["drug_index", "term_index"]].copy()
    df["score"] = s
    freq_col = edges["freq_str"] if "freq_str" in edges.columns else None
    df["freq_band"] = ([_freq_band(x) for x in freq_col]
                       if freq_col is not None else "unknown")

    grouped = (df.groupby("freq_band")
               .agg(n=("score", "size"),
                    mean_score=("score", "mean"),
                    median_score=("score", "median"))
               .reset_index()
               .sort_values("n", ascending=False)
               .reset_index(drop=True))
    assert int(grouped["n"].sum()) == len(edges), "freq groups do not reconcile"
    out = os.path.join(out_dir, "error_analysis_term_frequency.parquet")
    os.makedirs(out_dir, exist_ok=True)
    grouped.to_parquet(out, index=False)
    print(f"[kg.err.by_term_frequency] bands={len(grouped)} "
          f"total_pairs={len(edges)} -> {out}")
    return grouped


def by_drug_class(scores, edges, drugs_meta, out_dir=None):
    """Breakdown of mean score over positive pairs by drug class.

    `drugs_meta` is the nodes_drug frame (needs drug_index + drug_class). Null
    or missing classes bucket as 'unknown'. Writes
    error_analysis_drug_class.parquet and returns the grouping DataFrame; per-
    class `n` sums to len(edges).
    """
    out_dir = out_dir or _artifacts_dir_default()
    s = _score_for_rows(scores, edges)
    class_map = (drugs_meta.set_index("drug_index")["drug_class"]
                 if "drug_class" in drugs_meta.columns else None)
    df = edges[["drug_index", "term_index"]].copy()
    df["score"] = s
    if class_map is not None:
        cls = df["drug_index"].map(class_map)
    else:
        cls = pd.Series(["unknown"] * len(df), index=df.index)
    df["drug_class"] = cls.where(cls.notna() & (cls != ""), "unknown")

    grouped = (df.groupby("drug_class")
               .agg(n=("score", "size"),
                    n_drugs=("drug_index", "nunique"),
                    mean_score=("score", "mean"))
               .reset_index()
               .sort_values("n", ascending=False)
               .reset_index(drop=True))
    assert int(grouped["n"].sum()) == len(edges), "class groups do not reconcile"
    out = os.path.join(out_dir, "error_analysis_drug_class.parquet")
    os.makedirs(out_dir, exist_ok=True)
    grouped.to_parquet(out, index=False)
    print(f"[kg.err.by_drug_class] classes={len(grouped)} "
          f"total_pairs={len(edges)} -> {out}")
    return grouped


def by_label_sparsity(scores, edges, out_dir=None, bins=(1, 5, 20, 50, 100)):
    """Breakdown of mean score by how many positive terms each drug carries.

    Drugs are bucketed into label-count bands (sparse to richly annotated) and
    the mean score of their positive pairs reported per band. Writes
    error_analysis_label_sparsity.parquet and returns the grouping DataFrame;
    per-band `n` sums to len(edges).
    """
    out_dir = out_dir or _artifacts_dir_default()
    s = _score_for_rows(scores, edges)
    df = edges[["drug_index", "term_index"]].copy()
    df["score"] = s
    counts = df.groupby("drug_index")["term_index"].transform("size")
    df["n_pos_terms"] = counts

    edge_list = sorted(set(bins))
    labels = []
    lo = 1
    for b in edge_list:
        labels.append(f"{lo}-{b}" if lo != b else f"{b}")
        lo = b + 1
    labels.append(f"{lo}+")
    bin_edges = [0] + list(edge_list) + [np.inf]
    df["sparsity_band"] = pd.cut(df["n_pos_terms"], bins=bin_edges,
                                 labels=labels, right=True)

    grouped = (df.groupby("sparsity_band", observed=True)
               .agg(n=("score", "size"),
                    n_drugs=("drug_index", "nunique"),
                    mean_score=("score", "mean"))
               .reset_index()
               .sort_values("n", ascending=False)
               .reset_index(drop=True))
    assert int(grouped["n"].sum()) == len(edges), "sparsity groups do not reconcile"
    out = os.path.join(out_dir, "error_analysis_label_sparsity.parquet")
    os.makedirs(out_dir, exist_ok=True)
    grouped.to_parquet(out, index=False)
    print(f"[kg.err.by_label_sparsity] bands={len(grouped)} "
          f"total_pairs={len(edges)} -> {out}")
    return grouped


def _load_artifacts(artifacts_dir):
    nodes_drug = pd.read_parquet(os.path.join(artifacts_dir, "nodes_drug.parquet"))
    nodes_term = pd.read_parquet(os.path.join(artifacts_dir, "nodes_term.parquet"))
    edges_dt = pd.read_parquet(os.path.join(artifacts_dir, "edges_drug_term.parquet"))
    return nodes_drug, nodes_term, edges_dt


def main(artifacts_dir=None):
    """Smoke run over the FEAT-001 artifacts using the term-popularity prior
    as a stand-in scorer (keeps this module torch-free)."""
    artifacts_dir = artifacts_dir or _artifacts_dir_default()
    nodes_drug, nodes_term, edges_dt = _load_artifacts(artifacts_dir)

    import baselines as base
    n_terms = int(nodes_term["term_index"].max()) + 1
    model = base.term_popularity_prior(
        edges_dt[["drug_index", "term_index"]].to_numpy(), n_terms)
    pairs = edges_dt[["drug_index", "term_index"]].to_numpy()
    scores = base.predict_scores(model, pairs)

    by_term_frequency(scores, edges_dt, nodes_term, out_dir=artifacts_dir)
    by_drug_class(scores, edges_dt, nodes_drug, out_dir=artifacts_dir)
    by_label_sparsity(scores, edges_dt, out_dir=artifacts_dir)
    print("[kg.err] smoke complete: three breakdown parquet files written")


if __name__ == "__main__":
    main()
