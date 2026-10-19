"""
models/random_forest_model.py
=================================================================
Algorithm 1: Random Forest-Based Drug Allergy Prediction (baseline).

Real, runnable with scikit-learn (no GPU/deep-learning deps needed).
Trains on patient clinical tabular data to predict a general ADR-risk
probability, and exposes feature importances for the explainability
layer (Algorithm 9).
=================================================================
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score

CATEGORICAL_COLS = ["sex", "liver_function", "kidney_function", "diagnosis"]
NUMERIC_COLS = ["age", "weight_kg", "height_cm", "creatinine", "alt", "egfr",
                "n_allergies", "pgx_risk_allele_count", "pregnant", "on_warfarin"]
TARGET_COL = "adr_risk"


def load_dataset(path: str) -> pd.DataFrame:
    """Load dataset D containing patient demographics, medications, and allergies (line 2)."""
    df = pd.read_csv(path)
    print(f"[rf.load_dataset] loaded {len(df)} rows from {path}")
    return df


def preprocess(df: pd.DataFrame):
    """Remove missing/duplicate records, encode categoricals, normalize
    continuous variables (lines 3-5)."""
    df = df.dropna(subset=CATEGORICAL_COLS + NUMERIC_COLS + [TARGET_COL]).drop_duplicates(subset=["patient_id"]).copy()

    encoders = {}
    for col in CATEGORICAL_COLS:
        le = LabelEncoder()
        df[col + "_enc"] = le.fit_transform(df[col])
        encoders[col] = le

    scaler = StandardScaler()
    scaled = scaler.fit_transform(df[NUMERIC_COLS])
    scaled_cols = [c + "_scaled" for c in NUMERIC_COLS]
    df[scaled_cols] = scaled

    feature_cols = [c + "_enc" for c in CATEGORICAL_COLS] + scaled_cols
    print(f"[rf.preprocess] {len(df)} rows retained, {len(feature_cols)} features")
    return df, feature_cols, encoders, scaler


def split_dataset(df: pd.DataFrame, feature_cols: list, seed: int = 42):
    """Split dataset into training and testing sets (line 6)."""
    X = df[feature_cols].values
    y = df[TARGET_COL].values
    from splits import holdout_indices
    train_idx, test_idx = holdout_indices(y, seed=seed)
    X_train, X_test, y_train, y_test = X[train_idx], X[test_idx], y[train_idx], y[test_idx]
    print(f"[rf.split_dataset] train={len(X_train)} test={len(X_test)}")
    return X_train, X_test, y_train, y_test


def train_random_forest(X_train, y_train, n_trees: int = 200, max_depth: int = 8, seed: int = 42):
    """Initialize + train Random Forest classifier (lines 7-15). Each
    tree bootstrap-samples rows and (via max_features) a random subset
    of features -- this is exactly the "random subset of samples /
    random subset of features" step in the algorithm, handled
    internally by sklearn's implementation."""
    model = RandomForestClassifier(
        n_estimators=n_trees, max_depth=max_depth, max_features="sqrt",
        random_state=seed, class_weight="balanced", n_jobs=-1,
    )
    model.fit(X_train, y_train)
    print(f"[rf.train] trained {n_trees} trees, max_depth={max_depth}")
    return model


def evaluate(model, X_test, y_test):
    """Compute Accuracy, Precision, Recall, F1-score (lines 16-17)."""
    preds = model.predict(X_test)
    metrics = {
        "accuracy": accuracy_score(y_test, preds),
        "precision": precision_score(y_test, preds, zero_division=0),
        "recall": recall_score(y_test, preds, zero_division=0),
        "f1": f1_score(y_test, preds, zero_division=0),
    }
    print("[rf.evaluate] " + "  ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    return metrics


def feature_importances(model, feature_cols: list) -> pd.Series:
    """Important clinical features -- used by Algorithm 9 (explainability)."""
    return pd.Series(model.feature_importances_, index=feature_cols).sort_values(ascending=False)


def predict_proba_for_patient(model, feature_row: np.ndarray) -> float:
    """Deploy model for baseline drug compatibility / ADR-risk prediction (lines 18-20)."""
    return float(model.predict_proba(feature_row.reshape(1, -1))[0, 1])


def run(data_path: str = "data/clinical_data.csv", seed: int = 42):
    df = load_dataset(data_path)
    df, feature_cols, encoders, scaler = preprocess(df)
    X_train, X_test, y_train, y_test = split_dataset(df, feature_cols, seed=seed)
    model = train_random_forest(X_train, y_train, seed=seed)
    metrics = evaluate(model, X_test, y_test)
    importances = feature_importances(model, feature_cols)
    print("[rf.run] top features:\n" + importances.head(5).to_string())
    return {
        "model": model, "encoders": encoders, "scaler": scaler,
        "feature_cols": feature_cols, "metrics": metrics, "importances": importances,
        "df": df,
    }


if __name__ == "__main__":
    run()
