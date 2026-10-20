"""
research/kg/tests/test_ablations.py
=================================================================
FEAT-003 -- tests for ablations.run_ablation_matrix.

Proves:
  1. the results frame has exactly one row per (config, seed);
  2. dependency-absent cells are labeled status='skipped (dep absent)' with
     NaN metrics -- on the classical venv the 'graph' (torch) and
     '+structure' (RDKit) configs MUST be skipped, not failing the run;
  3. classical configs produce an 'ok' status with a finite point estimate
     bracketed by its CI;
  4. ablation_results.parquet is written.

Uses the real FEAT-001 artifacts (reads research/kg/artifacts/*.parquet) with
a tiny seed set and a small bootstrap count for speed. Runs under pytest and
exposes an assert-based __main__ fallback.
=================================================================
"""

import os
import sys

import numpy as np

_KG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _KG_DIR not in sys.path:
    sys.path.insert(0, _KG_DIR)

import ablations as abl  # noqa: E402

_ARTIFACTS = os.path.join(_KG_DIR, "artifacts")
_CONFIGS = ("popularity", "+tggates", "+structure", "graph")
_SEEDS = (0, 1)


def _run_matrix():
    return abl.run_ablation_matrix(
        configs=_CONFIGS, seeds=_SEEDS, n_boot=50,
        artifacts_dir=_ARTIFACTS,
        out_path=os.path.join(_ARTIFACTS, "ablation_results_test.parquet"))


def test_one_row_per_config_seed():
    res = _run_matrix()
    assert len(res) == len(_CONFIGS) * len(_SEEDS)
    counts = res.groupby(["config", "seed"]).size()
    assert (counts == 1).all(), "duplicate or missing (config, seed) rows"


def test_dep_absent_cells_are_skipped():
    res = _run_matrix()
    # 'graph' needs torch; '+structure' needs RDKit -> both absent on the venv.
    for cfg in ("graph", "+structure"):
        sub = res[res["config"] == cfg]
        assert (sub["status"] == abl.SKIPPED).all(), \
            f"{cfg} should be labeled '{abl.SKIPPED}'"
        assert sub["point"].isna().all(), f"{cfg} skipped cells must have NaN point"


def test_classical_cells_ok_and_ci_brackets_point():
    res = _run_matrix()
    ok = res[res["status"] == "ok"]
    assert len(ok) > 0, "expected at least one runnable classical cell"
    assert (ok["config"] == "popularity").any()
    for _, row in ok.iterrows():
        if np.isfinite(row["point"]) and np.isfinite(row["ci_lo"]) \
                and np.isfinite(row["ci_hi"]):
            assert row["ci_lo"] <= row["point"] <= row["ci_hi"], \
                f"CI does not bracket point for {row['config']} seed {row['seed']}"


def test_parquet_written():
    _run_matrix()
    out = os.path.join(_ARTIFACTS, "ablation_results_test.parquet")
    assert os.path.exists(out), "ablation results parquet not written"


def _run_all():
    test_one_row_per_config_seed()
    test_dep_absent_cells_are_skipped()
    test_classical_cells_ok_and_ci_brackets_point()
    test_parquet_written()
    print("[test_ablations] all assertions passed")


if __name__ == "__main__":
    _run_all()
