"""
research/kg/tests/test_baselines.py
=================================================================
FEAT-002 tests for baselines.py.

Each baseline must return FINITE scores of the expected shape on a small
synthetic graph built here. Pytest file; also exposes an assert-based
__main__ runner as a pytest fallback. Run either:
    research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests/test_baselines.py
    research/kg/.venv/Scripts/python.exe research/kg/tests/test_baselines.py
=================================================================
"""

import os
import sys

import numpy as np

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import baselines  # noqa: E402


# ---- small synthetic graph shared by the tests -------------------------
N_DRUGS = 8
N_TERMS = 6
TRAIN_EDGES = np.array([
    [0, 0], [0, 1], [1, 1], [1, 2], [2, 2], [3, 3], [4, 4], [5, 5], [6, 0],
])
DRUG_GENE = np.array([[0, 0], [1, 0], [1, 1], [2, 1], [3, 2], [4, 2]])
PROBE = np.array([[0, 0], [1, 2], [3, 3], [7, 5], [2, 4]])


def _assert_finite_shape(scores, n):
    scores = np.asarray(scores, dtype=float)
    assert scores.shape == (n,)
    assert np.all(np.isfinite(scores))


def test_term_popularity_prior():
    model = baselines.term_popularity_prior(TRAIN_EDGES, N_TERMS)
    assert model["term_prior"].shape == (N_TERMS,)
    scores = baselines.predict_scores(model, PROBE)
    _assert_finite_shape(scores, len(PROBE))
    assert np.all((scores >= 0.0) & (scores <= 1.0))


def test_drug_similarity_knn():
    sim = baselines.gene_jaccard_similarity(DRUG_GENE, N_DRUGS)
    assert sim.shape == (N_DRUGS, N_DRUGS)
    model = baselines.drug_similarity_knn(TRAIN_EDGES, sim, N_TERMS, k=3)
    scores = baselines.predict_scores(model, PROBE)
    _assert_finite_shape(scores, len(PROBE))
    assert np.all((scores >= 0.0) & (scores <= 1.0))


def test_logistic_regression_baseline():
    tp = baselines.term_popularity_prior(TRAIN_EDGES, N_TERMS)

    def feats(d, t):
        return np.array([float(d), float(t), tp["term_prior"][t]])

    model = baselines.logistic_regression_baseline(
        feats, TRAIN_EDGES, N_DRUGS, N_TERMS, neg_ratio=2, seed=42)
    scores = baselines.predict_scores(model, PROBE)
    _assert_finite_shape(scores, len(PROBE))
    assert np.all((scores >= 0.0) & (scores <= 1.0))


def test_matrix_factorisation():
    model = baselines.matrix_factorisation(
        TRAIN_EDGES, N_DRUGS, N_TERMS, dim=8, epochs=15, seed=42, neg_ratio=1)
    assert model["D"].shape == (N_DRUGS, 8)
    assert model["T"].shape == (N_TERMS, 8)
    scores = baselines.predict_scores(model, PROBE)
    _assert_finite_shape(scores, len(PROBE))
    assert np.all((scores >= 0.0) & (scores <= 1.0))


def test_sample_negatives_are_pu_pseudo_negatives():
    positives = {(int(d), int(t)) for d, t in TRAIN_EDGES}
    negs = baselines.sample_negatives(positives, N_DRUGS, N_TERMS, neg_ratio=1, seed=42)
    # negatives are drawn from the UNLABELED set, never overlap positives
    for d, t in negs:
        assert (int(d), int(t)) not in positives


def _run_all():
    test_term_popularity_prior()
    test_drug_similarity_knn()
    test_logistic_regression_baseline()
    test_matrix_factorisation()
    test_sample_negatives_are_pu_pseudo_negatives()
    print("[test_baselines] all assertions passed")


if __name__ == "__main__":
    _run_all()
