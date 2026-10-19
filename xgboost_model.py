"""
models/xgboost_model.py
=================================================================
Algorithm 2: XGBoost-Based Drug Compatibility Prediction.

Uses real xgboost if it's installed. If not (as in the sandbox this
was authored in, which has no internet access to pip install it),
it falls back to sklearn's HistGradientBoostingClassifier, which is
the same family of algorithm (gradient-boosted trees on residual
error) and needs no extra dependency -- so this module is always
runnable, and upgrades itself automatically once you `pip install
xgboost` in your own environment.
=================================================================
"""

import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

try:
    import xgboost as xgb
    BACKEND = "xgboost"
except ImportError:
    from sklearn.ensemble import HistGradientBoostingClassifier
    BACKEND = "sklearn-histgb-fallback"

from models.random_forest_model import CATEGORICAL_COLS, NUMERIC_COLS, TARGET_COL, load_dataset


def preprocess(df: pd.DataFrame):
    """Remove incomplete records, encode categorical variables, normalize
    numerical features (lines 3-5)."""
    df = df.dropna(subset=CATEGORICAL_COLS + NUMERIC_COLS + [TARGET_COL]).drop_duplicates(subset=["patient_id"]).copy()

    encoders = {}
    for col in CATEGORICAL_COLS:
        le = LabelEncoder()
        df[col + "_enc"] = le.fit_transform(df[col])
        encoders[col] = le

    scaler = StandardScaler()
    scaled_cols = [c + "_scaled" for c in NUMERIC_COLS]
    df[scaled_cols] = scaler.fit_transform(df[NUMERIC_COLS])

    feature_cols = [c + "_enc" for c in CATEGORICAL_COLS] + scaled_cols
    print(f"[xgb.preprocess] backend={BACKEND}, {len(df)} rows, {len(feature_cols)} features")
    return df, feature_cols, encoders, scaler


def split_dataset(df: pd.DataFrame, feature_cols: list, seed: int = 42):
    """Split dataset into training and testing sets (line 6)."""
    X = df[feature_cols].values
    y = df[TARGET_COL].values
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, random_state=seed, stratify=y
    )
    print(f"[xgb.split_dataset] train={len(X_train)} test={len(X_test)}")
    return X_train, X_test, y_train, y_test


def train_xgboost(X_train, y_train, learning_rate: float = 0.08, max_depth: int = 4,
                   n_estimators: int = 150, seed: int = 42):
    """Initialize XGBoost classifier, set learning rate / tree depth /
    boosting rounds, train (lines 7-14: each boosting iteration fits a
    tree to the residual error of the previous ensemble and updates it --
    this is exactly what `xgb.XGBClassifier.fit` / `HistGradientBoostingClassifier.fit`
    do internally)."""
    if BACKEND == "xgboost":
        model = xgb.XGBClassifier(
            learning_rate=learning_rate, max_depth=max_depth, n_estimators=n_estimators,
            random_state=seed, eval_metric="logloss", use_label_encoder=False,
        )
    else:
        model = HistGradientBoostingClassifier(
            learning_rate=learning_rate, max_depth=max_depth, max_iter=n_estimators,
            random_state=seed,
        )
    model.fit(X_train, y_train)
    print(f"[xgb.train] backend={BACKEND}  lr={learning_rate} depth={max_depth} rounds={n_estimators}")
    return model


def evaluate(model, X_test, y_test):
    """Compute Accuracy, Precision, Recall, F1-score (line 15)."""
    preds = model.predict(X_test)
    metrics = {
        "accuracy": accuracy_score(y_test, preds),
        "precision": precision_score(y_test, preds, zero_division=0),
        "recall": recall_score(y_test, preds, zero_division=0),
        "f1": f1_score(y_test, preds, zero_division=0),
    }
    print("[xgb.evaluate] " + "  ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    return metrics


def predict_proba_for_patient(model, feature_row: np.ndarray) -> float:
    """Deploy XGBoost predictor: input patient information, output
    predicted drug compatibility score (lines 17-19)."""
    return float(model.predict_proba(feature_row.reshape(1, -1))[0, 1])


def run(data_path: str = "data/clinical_data.csv", seed: int = 42):
    df = load_dataset(data_path)
    df, feature_cols, encoders, scaler = preprocess(df)
    X_train, X_test, y_train, y_test = split_dataset(df, feature_cols, seed=seed)
    model = train_xgboost(X_train, y_train, seed=seed)
    metrics = evaluate(model, X_test, y_test)
    return {
        "model": model, "encoders": encoders, "scaler": scaler,
        "feature_cols": feature_cols, "metrics": metrics, "df": df, "backend": BACKEND,
    }


if __name__ == "__main__":
    run()
