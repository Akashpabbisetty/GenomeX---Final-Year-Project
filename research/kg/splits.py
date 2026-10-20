"""
research/kg/splits.py
=================================================================
FEAT-001 -- Train/val/test splits for the drug->ADR KG experiment.

The primary, honest evaluation is DRUG-WISE COLD-START: held-out drugs
contribute NO label edge to the training set, so the model is scored on
drugs it never saw during training (per .kiro/steering/tech.md). Two
secondary splits are provided and clearly labelled:

  - term_wise_split: hold out TERMS (cold-start on side-effect vocabulary).
  - random_pair_split: random over (drug,term) pairs. This is the
    "optimistic" split -- it leaks drugs across train/test and MUST NOT be
    used for headline claims; it exists only as an upper-bound reference.

held_out_label_mask() enforces the cold-start contract on an edge table by
dropping every label edge that touches a held-out (val/test) drug.

Function-based module with `[kg.splits] ...` print-logging, mirroring
research/splits.py conventions. Fixed seed 42; splits are deterministic
for a given seed.

Run (smoke print):
    research/kg/.venv/Scripts/python.exe research/kg/splits.py
=================================================================
"""

import numpy as np

SEED = 42


def _three_way_split(items, seed, val_frac, test_frac):
    """Shuffle `items` deterministically and partition into train/val/test.

    Test is taken first, then val from the remainder, so train gets the rest.
    Returns a dict with numpy arrays under keys 'train', 'val', 'test'.
    """
    items = np.asarray(list(items))
    rng = np.random.default_rng(seed)
    perm = rng.permutation(len(items))
    shuffled = items[perm]

    n = len(shuffled)
    n_test = int(round(n * test_frac))
    n_val = int(round(n * val_frac))
    test = shuffled[:n_test]
    val = shuffled[n_test:n_test + n_val]
    train = shuffled[n_test + n_val:]
    return {
        "train": np.sort(train),
        "val": np.sort(val),
        "test": np.sort(test),
    }


def drug_wise_split(drug_indices, seed=SEED, val_frac=0.1, test_frac=0.2):
    """Cold-start split over DRUGS. Held-out drugs contribute no training
    label edges (enforced by held_out_label_mask). This is the primary,
    honest evaluation split.

    Returns {'train': ndarray, 'val': ndarray, 'test': ndarray} of drug ids.
    """
    split = _three_way_split(drug_indices, seed, val_frac, test_frac)
    print(f"[kg.splits] drug_wise_split (cold-start) train={len(split['train'])} "
          f"val={len(split['val'])} test={len(split['test'])} seed={seed}")
    return split


def term_wise_split(term_indices, seed=SEED, val_frac=0.1, test_frac=0.2):
    """Cold-start split over TERMS (side-effect vocabulary).

    Returns {'train','val','test'} of term ids.
    """
    split = _three_way_split(term_indices, seed, val_frac, test_frac)
    print(f"[kg.splits] term_wise_split train={len(split['train'])} "
          f"val={len(split['val'])} test={len(split['test'])} seed={seed}")
    return split


def random_pair_split(pairs, seed=SEED, val_frac=0.1, test_frac=0.2):
    """OPTIMISTIC split over (drug,term) pairs -- leaks drugs across folds.

    `pairs` is an iterable of (drug_index, term_index) tuples (or a 2-column
    array). NOT for headline claims; an optimistic upper-bound only.

    Returns {'train','val','test'} as arrays of [drug_index, term_index] rows.
    """
    arr = np.asarray(list(pairs))
    idx = np.arange(len(arr))
    split_idx = _three_way_split(idx, seed, val_frac, test_frac)
    split = {k: arr[v] for k, v in split_idx.items()}
    print(f"[kg.splits] random_pair_split (OPTIMISTIC, leaks drugs) "
          f"train={len(split['train'])} val={len(split['val'])} "
          f"test={len(split['test'])} seed={seed}")
    return split


def held_out_label_mask(edges_df, split, drug_col="drug_index"):
    """Return the subset of `edges_df` safe for TRAINING under a drug-wise
    split: every edge touching a held-out (val or test) drug is dropped.

    This guarantees the cold-start contract -- no held-out drug appears as an
    endpoint of any training label edge.
    """
    held_out = set(int(x) for x in np.concatenate([split["val"], split["test"]])) \
        if len(split["val"]) or len(split["test"]) else set()
    mask = ~edges_df[drug_col].isin(held_out)
    train_edges_df = edges_df[mask].reset_index(drop=True)
    print(f"[kg.splits] held_out_label_mask kept {len(train_edges_df)}/"
          f"{len(edges_df)} training edges (dropped "
          f"{len(edges_df) - len(train_edges_df)} touching "
          f"{len(held_out)} held-out drugs)")
    return train_edges_df


def main():
    """Smoke print over a synthetic drug set."""
    drug_indices = np.arange(100)
    split = drug_wise_split(drug_indices)
    print(f"[kg.splits] smoke: first 5 test drug ids = {split['test'][:5]}")
    import pandas as pd
    edges = pd.DataFrame({
        "drug_index": np.repeat(np.arange(100), 3),
        "term_index": np.tile(np.arange(3), 100),
    })
    train_edges = held_out_label_mask(edges, split)
    held = set(np.concatenate([split["val"], split["test"]]).tolist())
    leaked = set(train_edges["drug_index"].tolist()) & held
    print(f"[kg.splits] smoke: leaked held-out drugs on training edges = "
          f"{len(leaked)} (expected 0)")


if __name__ == "__main__":
    main()
