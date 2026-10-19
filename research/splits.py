"""
splits.py
=================================================================
One shared hold-out split used by EVERY model (RF, XGBoost, CNN, Bi-LSTM,
Fusion). Previously each model split its own data independently, so the
fusion network could not be evaluated honestly: a row held out for one
model was often in another model's training set.

Also provides out-of-fold (OOF) probabilities for the tree models. If the
fusion network is fed a tree model's *in-sample* predictions it learns to
trust them blindly (they look near-perfect on training rows) -- classic
stacking leakage. OOF predictions for training rows and genuine hold-out
predictions for test rows remove that.
=================================================================
"""

import numpy as np
from sklearn.base import clone
from sklearn.model_selection import train_test_split, cross_val_predict, StratifiedKFold


def holdout_indices(labels: np.ndarray, seed: int = 42, test_size: float = 0.25):
    labels = np.asarray(labels)
    return train_test_split(np.arange(len(labels)), test_size=test_size, random_state=seed, stratify=labels)


def stacked_proba(fitted_model, X: np.ndarray, y: np.ndarray, train_idx, test_idx, seed: int = 42, n_splits: int = 5):
    """Leak-free probabilities for every row:
      - train rows: 5-fold out-of-fold predictions (each row scored by a
        model that never saw it)
      - test rows : predictions from `fitted_model` (trained on train rows only)
    `fitted_model` must already be fit on X[train_idx]."""
    proba = np.zeros(len(X), dtype=np.float32)
    cv = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    oof = cross_val_predict(clone(fitted_model), X[train_idx], y[train_idx], cv=cv, method="predict_proba")[:, 1]
    proba[train_idx] = oof
    proba[test_idx] = fitted_model.predict_proba(X[test_idx])[:, 1]
    return proba
