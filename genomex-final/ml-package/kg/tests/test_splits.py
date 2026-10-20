"""
research/kg/tests/test_splits.py
=================================================================
FEAT-001 -- unit tests for the drug-wise cold-start split contract.

Proves:
  1. train/test drug-index sets are disjoint (zero overlap);
  2. after held_out_label_mask, no held-out (val/test) drug appears as an
     endpoint of any training label edge;
  3. splits are deterministic across two calls with the same seed.

Runs under pytest; also exposes an assert-based `__main__` fallback runner
(invoke directly with the venv python if pytest is unavailable).
=================================================================
"""

import os
import sys

import numpy as np
import pandas as pd

# Make research/kg/ importable whether run via pytest or directly.
_KG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _KG_DIR not in sys.path:
    sys.path.insert(0, _KG_DIR)

from splits import drug_wise_split, held_out_label_mask, random_pair_split  # noqa: E402


def _synthetic_edges(n_drugs=200, terms_per_drug=5):
    """Build a dense synthetic drug-term edge table for the contract tests."""
    drug_indices = np.arange(n_drugs)
    rows = []
    for di in drug_indices:
        for ti in range(terms_per_drug):
            rows.append({"drug_index": int(di), "term_index": int(ti)})
    return drug_indices, pd.DataFrame(rows)


def test_train_test_drug_disjoint():
    drug_indices, _ = _synthetic_edges()
    split = drug_wise_split(drug_indices, seed=42)
    train = set(split["train"].tolist())
    test = set(split["test"].tolist())
    val = set(split["val"].tolist())
    assert train.isdisjoint(test), "train/test drug sets overlap"
    assert train.isdisjoint(val), "train/val drug sets overlap"
    assert val.isdisjoint(test), "val/test drug sets overlap"
    # Every drug lands in exactly one fold.
    assert train | val | test == set(drug_indices.tolist())


def test_no_heldout_drug_on_training_edges():
    drug_indices, edges = _synthetic_edges()
    split = drug_wise_split(drug_indices, seed=42)
    train_edges = held_out_label_mask(edges, split)
    held_out = set(np.concatenate([split["val"], split["test"]]).tolist())
    endpoints = set(train_edges["drug_index"].tolist())
    assert endpoints.isdisjoint(held_out), \
        "a held-out drug appears on a training label edge"
    # Training edges should cover exactly the training drugs that have edges.
    assert endpoints == set(split["train"].tolist())


def test_split_deterministic():
    drug_indices, _ = _synthetic_edges()
    a = drug_wise_split(drug_indices, seed=42)
    b = drug_wise_split(drug_indices, seed=42)
    for key in ("train", "val", "test"):
        assert np.array_equal(a[key], b[key]), f"{key} fold not deterministic"
    # A different seed should (almost surely) produce a different partition.
    c = drug_wise_split(drug_indices, seed=7)
    assert not np.array_equal(a["test"], c["test"])


def test_random_pair_split_shapes():
    _, edges = _synthetic_edges(n_drugs=50, terms_per_drug=4)
    pairs = list(zip(edges["drug_index"], edges["term_index"]))
    split = random_pair_split(pairs, seed=42)
    total = len(split["train"]) + len(split["val"]) + len(split["test"])
    assert total == len(pairs), "random_pair_split lost or duplicated pairs"


def _run_all():
    """Assert-based fallback runner (used when pytest is unavailable)."""
    test_train_test_drug_disjoint()
    test_no_heldout_drug_on_training_edges()
    test_split_deterministic()
    test_random_pair_split_shapes()
    print("[kg.splits.test] all assertions passed")


if __name__ == "__main__":
    _run_all()
