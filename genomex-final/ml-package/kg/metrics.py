"""
research/kg/metrics.py
=================================================================
FEAT-002 -- Evaluation metrics for the drug->ADR KG experiment.

Pure, dependency-light scoring helpers (scikit-learn + numpy only; no
torch/RDKit/matplotlib). Every metric is computed on POSITIVE-UNLABELED
data: a (drug, cui) pair present in edges_drug_term is a POSITIVE; an
absent pair is UNLABELED, never a confirmed negative. For ranking metrics
the unlabeled pairs are treated as the pseudo-negative background, which is
the standard PU convention -- so AUROC/AUPRC here are optimistic upper
bounds, not calibrated true/false rates. This caveat is documented at the
model-card level too.

Functions:
  - auroc(y_true, y_score)                     area under ROC curve
  - auprc(y_true, y_score)                      area under precision-recall
  - precision_at_k_per_drug(...)                mean + per-drug precision@k
  - expected_calibration_error(...)             (ece, reliability_table_df)
  - bootstrap_ci(metric_fn, grouped_by_drug..)  CI by resampling held-out DRUGS

bootstrap_ci resamples DRUGS (groups), not individual pairs, so the
confidence interval reflects the cold-start uncertainty of generalising to
new drugs (per .kiro/steering/tech.md). Fixed seed default 42.

Function-based module with `[kg.metrics] ...` print-logging, mirroring
research/models/random_forest_model.py conventions.

Run (smoke print):
    research/kg/.venv/Scripts/python.exe research/kg/metrics.py
=================================================================
"""

import numpy as np
import pandas as pd
from sklearn.metrics import roc_auc_score, average_precision_score

SEED = 42


def auroc(y_true, y_score):
    """Area under the ROC curve. `y_true` is binary (1=positive label,
    0=unlabeled/pseudo-negative), `y_score` is the model score. Returns a
    float; returns nan with a printed note if only one class is present."""
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score, dtype=float)
    if len(np.unique(y_true)) < 2:
        print("[kg.metrics.auroc] single-class y_true -> AUROC undefined (nan)")
        return float("nan")
    val = float(roc_auc_score(y_true, y_score))
    print(f"[kg.metrics.auroc] n={len(y_true)} pos={int(y_true.sum())} auroc={val:.4f}")
    return val


def auprc(y_true, y_score):
    """Area under the precision-recall curve (average precision). More
    informative than AUROC under the heavy class imbalance of PU ADR data.
    Returns a float; nan with a printed note if no positives present."""
    y_true = np.asarray(y_true)
    y_score = np.asarray(y_score, dtype=float)
    if y_true.sum() == 0:
        print("[kg.metrics.auprc] no positives in y_true -> AUPRC undefined (nan)")
        return float("nan")
    val = float(average_precision_score(y_true, y_score))
    print(f"[kg.metrics.auprc] n={len(y_true)} pos={int(y_true.sum())} auprc={val:.4f}")
    return val


def _precision_at_k(y_true_row, y_score_row, k):
    """Precision@k for one drug: fraction of the top-k scored terms that are
    true positives. k is clamped to the number of available terms."""
    y_true_row = np.asarray(y_true_row)
    y_score_row = np.asarray(y_score_row, dtype=float)
    n = len(y_score_row)
    if n == 0:
        return float("nan")
    kk = min(k, n)
    # argsort descending; stable so ties resolve deterministically
    top = np.argsort(-y_score_row, kind="stable")[:kk]
    return float(y_true_row[top].sum()) / float(kk)


def precision_at_k_per_drug(y_true_by_drug, y_score_by_drug, k):
    """Precision@k computed PER DRUG then averaged.

    `y_true_by_drug` / `y_score_by_drug` are dicts {drug_id -> 1d array over
    that drug's candidate terms} (same ordering within a drug), OR 2d arrays
    of shape (n_drugs, n_terms). Returns (mean_precision_at_k, per_drug_series)
    where per_drug_series is a pandas Series indexed by drug id.

    Drugs with no positive labels are kept (their precision is a valid 0.0 or
    nan when they have no candidate terms); callers that only want drugs with
    positives should filter upstream.
    """
    if isinstance(y_true_by_drug, dict):
        drug_ids = list(y_true_by_drug.keys())
        per_drug = {
            d: _precision_at_k(y_true_by_drug[d], y_score_by_drug[d], k)
            for d in drug_ids
        }
    else:
        yt = np.asarray(y_true_by_drug)
        ys = np.asarray(y_score_by_drug)
        drug_ids = list(range(yt.shape[0]))
        per_drug = {
            d: _precision_at_k(yt[d], ys[d], k) for d in drug_ids
        }
    series = pd.Series(per_drug, name=f"precision_at_{k}")
    mean = float(np.nanmean(series.values)) if len(series) else float("nan")
    print(f"[kg.metrics.precision_at_k_per_drug] k={k} n_drugs={len(series)} "
          f"mean_p@{k}={mean:.4f}")
    return mean, series


def expected_calibration_error(y_true, y_score, n_bins=10):
    """Expected Calibration Error with a reliability table.

    Scores are bucketed into `n_bins` equal-width bins over [0,1]. ECE is the
    sample-weighted mean absolute gap between each bin's mean predicted score
    (confidence) and its observed positive rate (accuracy). Returns
    (ece: float, reliability_table: DataFrame) with columns
    [bin_lo, bin_hi, count, mean_score, pos_rate, gap].
    """
    y_true = np.asarray(y_true, dtype=float)
    y_score = np.asarray(y_score, dtype=float)
    n = len(y_true)
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    # bin index in [0, n_bins-1]; clip right edge into the last bin
    bin_idx = np.clip(np.digitize(y_score, edges[1:-1], right=False), 0, n_bins - 1)

    rows = []
    ece = 0.0
    for b in range(n_bins):
        mask = bin_idx == b
        count = int(mask.sum())
        if count:
            mean_score = float(y_score[mask].mean())
            pos_rate = float(y_true[mask].mean())
            gap = abs(mean_score - pos_rate)
            ece += (count / n) * gap
        else:
            mean_score = float("nan")
            pos_rate = float("nan")
            gap = float("nan")
        rows.append({
            "bin_lo": float(edges[b]),
            "bin_hi": float(edges[b + 1]),
            "count": count,
            "mean_score": mean_score,
            "pos_rate": pos_rate,
            "gap": gap,
        })
    reliability_table = pd.DataFrame(rows)
    ece = float(ece)
    print(f"[kg.metrics.expected_calibration_error] n={n} n_bins={n_bins} "
          f"ece={ece:.4f}")
    return ece, reliability_table


def bootstrap_ci(metric_fn, grouped_by_drug, n_boot=1000, seed=SEED, alpha=0.05):
    """Bootstrap confidence interval by resampling held-out DRUGS (groups),
    not individual pairs.

    `grouped_by_drug` is an ordered sequence of per-drug items (one entry per
    held-out drug); `metric_fn(sample)` takes a list of such items and returns
    a scalar metric. On each of `n_boot` iterations we draw len(groups) drugs
    WITH REPLACEMENT and recompute the metric. Returns (point, lo, hi) where
    `point` is the metric on the full set and (lo, hi) are the alpha/2 and
    1-alpha/2 percentiles of the bootstrap distribution.

    Resampling drugs (not pairs) makes the CI reflect uncertainty in
    generalising to UNSEEN drugs -- the cold-start question that matters here.
    """
    groups = list(grouped_by_drug)
    n_groups = len(groups)
    point = float(metric_fn(groups))
    if n_groups == 0:
        print("[kg.metrics.bootstrap_ci] empty groups -> point/lo/hi = nan")
        return float("nan"), float("nan"), float("nan")

    rng = np.random.default_rng(seed)
    stats = np.empty(n_boot, dtype=float)
    for i in range(n_boot):
        idx = rng.integers(0, n_groups, size=n_groups)
        sample = [groups[j] for j in idx]
        stats[i] = metric_fn(sample)

    finite = stats[np.isfinite(stats)]
    if len(finite) == 0:
        lo = hi = float("nan")
    else:
        lo = float(np.percentile(finite, 100.0 * (alpha / 2.0)))
        hi = float(np.percentile(finite, 100.0 * (1.0 - alpha / 2.0)))
    print(f"[kg.metrics.bootstrap_ci] n_boot={n_boot} n_drugs={n_groups} "
          f"point={point:.4f} ci=({lo:.4f},{hi:.4f}) alpha={alpha}")
    return point, lo, hi


def main():
    """Smoke print over small synthetic toys."""
    rng = np.random.default_rng(SEED)

    # Perfectly separable -> AUROC 1.0
    y_true = np.array([0, 0, 0, 1, 1, 1])
    y_score = np.array([0.1, 0.2, 0.3, 0.7, 0.8, 0.9])
    print(f"[kg.metrics] smoke auroc(separable) = {auroc(y_true, y_score):.3f}")
    print(f"[kg.metrics] smoke auprc(separable) = {auprc(y_true, y_score):.3f}")

    # Per-drug precision@k on a 2-drug toy
    yt = np.array([[1, 0, 1, 0], [0, 1, 0, 0]])
    ys = np.array([[0.9, 0.1, 0.8, 0.2], [0.3, 0.9, 0.4, 0.1]])
    mean, per = precision_at_k_per_drug(yt, ys, k=2)
    print(f"[kg.metrics] smoke mean p@2 = {mean:.3f}")

    # ECE of a perfectly-calibrated toy ~ 0
    p = rng.uniform(0, 1, size=5000)
    labels = (rng.uniform(0, 1, size=5000) < p).astype(int)
    ece, table = expected_calibration_error(labels, p, n_bins=10)
    print(f"[kg.metrics] smoke calibrated ece = {ece:.3f} (expected ~0)")

    # bootstrap_ci over drug-grouped AUROC
    groups = [(np.array([0, 1]), np.array([0.2, 0.8])) for _ in range(30)]

    def grouped_auroc(sample):
        yt = np.concatenate([g[0] for g in sample])
        ys = np.concatenate([g[1] for g in sample])
        return roc_auc_score(yt, ys)

    point, lo, hi = bootstrap_ci(grouped_auroc, groups, n_boot=200)
    print(f"[kg.metrics] smoke bootstrap point={point:.3f} ci=({lo:.3f},{hi:.3f})")


if __name__ == "__main__":
    main()
