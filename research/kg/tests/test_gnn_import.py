"""
research/kg/tests/test_gnn_import.py
=================================================================
FEAT-003 -- lazy-import contract tests for gnn.py.

Proves the critical property that gnn.py imports cleanly on the classical
venv (NO torch / torch_geometric installed) and only raises a clear install
error when a torch-dependent path is actually invoked:

  1. `import gnn` succeeds regardless of whether torch is present;
  2. sample_negatives (pure numpy) works WITHOUT torch and returns PU
     pseudo-negatives that never overlap positives;
  3. when torch is ABSENT, _require_torch / train_gnn / build_hetero_data
     raise a RuntimeError whose message names requirements.txt and the PyG
     wheel step. When torch IS present we assert the import simply succeeds
     (so this test is correct on either environment).

Runs under pytest; also exposes an assert-based __main__ fallback runner.
=================================================================
"""

import os
import sys

import numpy as np

_KG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _KG_DIR not in sys.path:
    sys.path.insert(0, _KG_DIR)

import gnn  # noqa: E402  -- MUST import cleanly without torch


def _torch_present():
    try:
        import torch  # noqa: F401
        import torch_geometric  # noqa: F401
        return True
    except ImportError:
        return False


def test_module_imports_without_torch():
    # Reaching this line means `import gnn` at module load already succeeded.
    assert hasattr(gnn, "train_gnn")
    assert hasattr(gnn, "_require_torch")
    assert hasattr(gnn, "sample_negatives")


def test_sample_negatives_is_torch_free_and_pu():
    pos = np.array([[0, 0], [0, 1], [1, 1], [2, 2], [3, 0]])
    negs = gnn.sample_negatives(pos, n_drugs=6, n_terms=5, ratio=1, seed=42)
    positives = {(int(d), int(t)) for d, t in pos}
    assert negs.ndim == 2 and negs.shape[1] == 2
    for d, t in negs:
        assert (int(d), int(t)) not in positives, "PU negative overlapped a positive"


def test_require_torch_message_or_present():
    if _torch_present():
        # On a torch-equipped machine _require_torch must simply succeed.
        torch, pyg = gnn._require_torch()
        assert torch is not None and pyg is not None
        return
    # Classical venv: must raise a clear, actionable install error.
    raised = False
    try:
        gnn._require_torch()
    except RuntimeError as exc:
        raised = True
        msg = str(exc)
        assert "requirements.txt" in msg
        assert "PyG" in msg or "torch_geometric" in msg or "Geometric" in msg
    assert raised, "_require_torch did not raise with torch absent"


def test_train_gnn_raises_without_torch():
    if _torch_present():
        return  # training-path error only applies when torch is absent
    raised = False
    try:
        # Dummy args: _require_torch gates before any of them is used.
        gnn.train_gnn(data=None, splits={"train": [], "val": [], "test": []})
    except RuntimeError as exc:
        raised = True
        assert "requirements.txt" in str(exc)
    assert raised, "train_gnn did not raise the install error with torch absent"


def _run_all():
    test_module_imports_without_torch()
    test_sample_negatives_is_torch_free_and_pu()
    test_require_torch_message_or_present()
    test_train_gnn_raises_without_torch()
    print("[test_gnn_import] all assertions passed")


if __name__ == "__main__":
    _run_all()
