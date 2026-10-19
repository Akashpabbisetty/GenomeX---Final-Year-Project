"""
research/kg/tests/test_error_analysis.py
=================================================================
FEAT-003 -- tests for error_analysis.py breakdowns.

Proves that each breakdown's per-group counts RECONCILE to the total number
of scored positive pairs (nothing dropped or double-counted), that null drug
classes bucket as 'unknown', and that the three Parquet files are written.

Uses a small synthetic edge/term/drug frame so the test is fast and
self-contained (no dependency on the generated artifacts), plus a reconcile
check against the real artifacts when they are present. Runs under pytest and
exposes an assert-based __main__ fallback.
=================================================================
"""

import os
import sys
import tempfile

import numpy as np
import pandas as pd

_KG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _KG_DIR not in sys.path:
    sys.path.insert(0, _KG_DIR)

import error_analysis as err  # noqa: E402

_ARTIFACTS = os.path.join(_KG_DIR, "artifacts")


def _synthetic():
    edges = pd.DataFrame({
        "drug_index": [0, 0, 0, 1, 1, 2, 3, 3, 3, 3],
        "term_index": [0, 1, 2, 0, 3, 1, 0, 1, 2, 4],
        "freq_str":  ["14.7%", "2.0%", "0.3%", "common", None,
                       "rare", "postmarketing", "0.5%", None, "20%"],
    })
    terms = pd.DataFrame({
        "cui": [f"C{i}" for i in range(5)],
        "term_index": list(range(5)),
        "label": [f"term{i}" for i in range(5)],
    })
    drugs = pd.DataFrame({
        "drug_index": [0, 1, 2, 3],
        "drug_class": ["NSAID", None, "", "antibiotic"],
    })
    scores = np.linspace(0.1, 0.9, len(edges))
    return edges, terms, drugs, scores


def test_term_frequency_reconciles():
    edges, terms, drugs, scores = _synthetic()
    with tempfile.TemporaryDirectory() as tmp:
        g = err.by_term_frequency(scores, edges, terms, out_dir=tmp)
        assert int(g["n"].sum()) == len(edges)
        assert os.path.exists(os.path.join(tmp, "error_analysis_term_frequency.parquet"))


def test_drug_class_reconciles_and_unknown_bucket():
    edges, terms, drugs, scores = _synthetic()
    with tempfile.TemporaryDirectory() as tmp:
        g = err.by_drug_class(scores, edges, drugs, out_dir=tmp)
        assert int(g["n"].sum()) == len(edges)
        # drugs 1 (None) and 2 ("") both bucket as 'unknown'
        assert "unknown" in set(g["drug_class"])
        unknown_pairs = int(g.loc[g["drug_class"] == "unknown", "n"].sum())
        # drug 1 has 2 pairs, drug 2 has 1 pair -> 3 unknown-class pairs
        assert unknown_pairs == 3
        assert os.path.exists(os.path.join(tmp, "error_analysis_drug_class.parquet"))


def test_label_sparsity_reconciles():
    edges, terms, drugs, scores = _synthetic()
    with tempfile.TemporaryDirectory() as tmp:
        g = err.by_label_sparsity(scores, edges, out_dir=tmp)
        assert int(g["n"].sum()) == len(edges)
        assert os.path.exists(os.path.join(tmp, "error_analysis_label_sparsity.parquet"))


def test_reconciles_on_real_artifacts_if_present():
    dt_path = os.path.join(_ARTIFACTS, "edges_drug_term.parquet")
    if not os.path.exists(dt_path):
        return  # artifacts not built in this environment -> skip
    import baselines as base
    edges = pd.read_parquet(dt_path)
    terms = pd.read_parquet(os.path.join(_ARTIFACTS, "nodes_term.parquet"))
    drugs = pd.read_parquet(os.path.join(_ARTIFACTS, "nodes_drug.parquet"))
    n_terms = int(terms["term_index"].max()) + 1
    model = base.term_popularity_prior(
        edges[["drug_index", "term_index"]].to_numpy(), n_terms)
    scores = base.predict_scores(model, edges[["drug_index", "term_index"]].to_numpy())
    with tempfile.TemporaryDirectory() as tmp:
        g1 = err.by_term_frequency(scores, edges, terms, out_dir=tmp)
        g2 = err.by_drug_class(scores, edges, drugs, out_dir=tmp)
        g3 = err.by_label_sparsity(scores, edges, out_dir=tmp)
        assert int(g1["n"].sum()) == len(edges)
        assert int(g2["n"].sum()) == len(edges)
        assert int(g3["n"].sum()) == len(edges)


def _run_all():
    test_term_frequency_reconciles()
    test_drug_class_reconciles_and_unknown_bucket()
    test_label_sparsity_reconciles()
    test_reconciles_on_real_artifacts_if_present()
    print("[test_error_analysis] all assertions passed")


if __name__ == "__main__":
    _run_all()
