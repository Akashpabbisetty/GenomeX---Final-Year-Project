"""
research/kg/tests/test_export.py
=================================================================
FEAT-004 -- tests for export.py.

Proves:
  - export_scores writes a Parquet with EXACTLY the columns
    drug_id, cui, score, model_version, model_hash (and sane dtypes/values).
  - write_model_card produces a card containing the PU caveat, the three
    dataset licences (ClinPGx CC BY-SA, SIDER, TG-GATEs), and an explicit
    'research only / never overrides rules' statement.
  - model_hash is stable for the same scores and changes when scores change.

Uses a small synthetic score frame + a temp dir so the test is fast and does
not depend on the generated artifacts. Runs under pytest and exposes an
assert-based __main__ fallback.
=================================================================
"""

import os
import sys
import tempfile

import pandas as pd

_KG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _KG_DIR not in sys.path:
    sys.path.insert(0, _KG_DIR)

import export as exp  # noqa: E402

_REQUIRED_COLUMNS = ["drug_id", "cui", "score", "model_version", "model_hash"]


def _synthetic_scores():
    return pd.DataFrame({
        "drug_id": ["acetaminophen", "acetaminophen", "ibuprofen"],
        "cui": ["C0151828", "C0000737", "C0151828"],
        "score": [0.91, 0.42, 0.73],
    })


def test_export_scores_schema():
    scores = _synthetic_scores()
    with tempfile.TemporaryDirectory() as td:
        out = os.path.join(td, "assoc_scores.parquet")
        out_path, mhash = exp.export_scores(
            scores, model_version="unit_test_v1", graph_hash="deadbeef",
            out=out)
        assert os.path.exists(out_path)
        df = pd.read_parquet(out_path)
        # EXACT column set and order.
        assert list(df.columns) == _REQUIRED_COLUMNS, list(df.columns)
        assert len(df) == len(scores)
        # model_version/model_hash constant across rows; hash is a hex sha256.
        assert set(df["model_version"]) == {"unit_test_v1"}
        assert set(df["model_hash"]) == {mhash}
        assert len(mhash) == 64 and all(c in "0123456789abcdef" for c in mhash)
        # scores round-tripped as floats.
        assert df["score"].dtype.kind == "f"


def test_model_hash_is_stable_and_sensitive():
    scores = _synthetic_scores()
    h1 = exp.model_hash(scores)
    h2 = exp.model_hash(scores.sample(frac=1.0, random_state=1))  # reorder rows
    assert h1 == h2, "hash must be order-independent for the same content"
    changed = scores.copy()
    changed.loc[0, "score"] = 0.123456
    h3 = exp.model_hash(changed)
    assert h3 != h1, "hash must change when a score changes"


def test_model_card_contains_required_statements():
    with tempfile.TemporaryDirectory() as td:
        card = os.path.join(td, "MODEL_CARD.md")
        exp.write_model_card(path=card)
        with open(card, "r", encoding="utf-8") as fh:
            text = fh.read()
        low = text.lower()

        # PU caveat: absent == unlabeled, not a confirmed negative.
        assert "positive-unlabeled" in low or "positive-unlabeled (pu)" in low
        assert "unlabeled" in low and "not a confirmed negative" in low

        # The three dataset licences.
        assert "cc by-sa" in low                       # ClinPGx CC BY-SA
        assert "clinpgx" in low
        assert "sider" in low
        assert "tg-gates" in low

        # Research-only / never-overrides-rules intended use.
        assert "research only" in low
        assert "never override" in low or "never overrides" in low
        assert "rule category" in low

        # Rat-data limitation for TG-GATEs.
        assert "rat" in low


def _run_all():
    test_export_scores_schema()
    test_model_hash_is_stable_and_sensitive()
    test_model_card_contains_required_statements()
    print("[test_export] all assertions passed")


if __name__ == "__main__":
    _run_all()
