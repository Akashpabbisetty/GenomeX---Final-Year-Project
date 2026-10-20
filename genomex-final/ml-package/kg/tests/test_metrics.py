"""
research/kg/tests/test_metrics.py
=================================================================
FEAT-002 tests for metrics.py.

Pytest file; also exposes an assert-based __main__ runner as a fallback for
environments without pytest. Run either:
    research/kg/.venv/Scripts/python.exe -m pytest research/kg/tests/test_metrics.py
    research/kg/.venv/Scripts/python.exe research/kg/tests/test_metrics.py
=================================================================
"""

import os
import sys

import numpy as np

# make `import metrics` work regardless of cwd
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import metrics  # noqa: E402


def test_auroc_perfectly_separable_is_one():
    y_true = np.array([0, 0, 0, 1, 1, 1])
    y_score = np.array([0.1, 0.2, 0.3, 0.7, 0.8, 0.9])
    assert metrics.auroc(y_true, y_score) == 1.0


def test_auprc_perfectly_separable_is_one():
    y_true = np.array([0, 0, 1, 1])
    y_score = np.array([0.1, 0.2, 0.8, 0.9])
    assert metrics.auprc(y_true, y_score) == 1.0


def test_ece_perfectly_calibrated_is_near_zero():
    rng = np.random.default_rng(42)
    p = rng.uniform(0.0, 1.0, size=20000)
    labels = (rng.uniform(0.0, 1.0, size=20000) < p).astype(int)
    ece, table = metrics.expected_calibration_error(labels, p, n_bins=10)
    assert ece < 0.05
    # reliability table has one row per bin with the documented columns
    assert len(table) == 10
    assert set(["bin_lo", "bin_hi", "count", "mean_score", "pos_rate", "gap"]).issubset(table.columns)


def test_precision_at_k_per_drug_shapes_and_values():
    yt = np.array([[1, 0, 1, 0], [0, 1, 0, 0]])
    ys = np.array([[0.9, 0.1, 0.8, 0.2], [0.3, 0.9, 0.4, 0.1]])
    mean, per = metrics.precision_at_k_per_drug(yt, ys, k=2)
    # drug 0: top-2 scores pick terms 0,2 -> both positive -> 1.0
    # drug 1: top-2 scores pick terms 1,2 -> one positive -> 0.5
    assert per.iloc[0] == 1.0
    assert per.iloc[1] == 0.5
    assert abs(mean - 0.75) < 1e-9
    assert len(per) == 2


def test_bootstrap_ci_brackets_point_estimate():
    rng = np.random.default_rng(0)
    # 40 held-out drugs, each a (y_true, y_score) pair with signal
    groups = []
    for _ in range(40):
        yt = np.array([0, 0, 1, 1])
        noise = rng.normal(0, 0.1, size=4)
        ys = np.array([0.2, 0.3, 0.7, 0.8]) + noise
        groups.append((yt, ys))

    def grouped_auroc(sample):
        yt = np.concatenate([g[0] for g in sample])
        ys = np.concatenate([g[1] for g in sample])
        return metrics.auroc(yt, ys)

    point, lo, hi = metrics.bootstrap_ci(grouped_auroc, groups, n_boot=300, seed=42)
    assert np.isfinite(point) and np.isfinite(lo) and np.isfinite(hi)
    assert lo <= point <= hi


def _run_all():
    test_auroc_perfectly_separable_is_one()
    test_auprc_perfectly_separable_is_one()
    test_ece_perfectly_calibrated_is_near_zero()
    test_precision_at_k_per_drug_shapes_and_values()
    test_bootstrap_ci_brackets_point_estimate()
    print("[test_metrics] all assertions passed")


if __name__ == "__main__":
    _run_all()
