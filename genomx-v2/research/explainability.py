"""
explainability.py
=================================================================
Algorithm 9: Explainable AI-Based Drug Recommendation.

Three explainability techniques, one per model family, all
implemented directly (no extra dependency required -- this sandbox
had no internet access to `pip install shap`, so genuine SHAP values
are not used here; see the notes on each function for exactly what
substitutes for what, and how to upgrade to the real thing):

  - Random Forest / XGBoost: sklearn's permutation_importance (a
    model-agnostic, real, run-anywhere alternative to SHAP -- ranks
    features by how much shuffling them hurts model performance).
    If you `pip install shap`, swap in shap.TreeExplainer for exact
    per-prediction Shapley values.

  - CNN / Bi-LSTM: a finite-difference saliency map (perturb each
    input position, measure the change in output). This is a real,
    working approximation to Integrated Gradients that needs no
    autograd access from outside the model -- if you want the exact
    algorithm, swap in captum.attr.IntegratedGradients once torch is
    installed.

  - GNN: a perturbation-based edge/node importance score (mask one
    edge or node at a time, measure the change in the predicted
    compatibility score) -- the same idea as PyTorch Geometric's real
    GNNExplainer, implemented directly here without that dependency.
=================================================================
"""

import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance


# ---- Random Forest / XGBoost feature importance (lines 4, 7) --------
def explain_tabular_model(model, X_test: np.ndarray, y_test: np.ndarray, feature_names: list,
                           n_repeats: int = 20, seed: int = 42) -> pd.Series:
    result = permutation_importance(
        model, X_test, y_test, n_repeats=n_repeats, random_state=seed, scoring="f1"
    )
    importances = pd.Series(result.importances_mean, index=feature_names).sort_values(ascending=False)
    print("[explain.tabular] top features by permutation importance:\n" + importances.head(5).to_string())
    return importances


# ---- CNN / Bi-LSTM saliency (line 5) ---------------------------------
def explain_sequence_model(predict_fn, seqs: np.ndarray, pad_token_id: int = 0) -> np.ndarray:
    """predict_fn(seqs) -> np.ndarray of shape (N,) risk probabilities.
    Returns a (N, seq_len) saliency matrix: how much the predicted risk
    changes when each sequence position is masked out (replaced with
    the PAD token), as a finite-difference stand-in for gradient-based
    attribution."""
    base_probs = predict_fn(seqs)
    n, seq_len = seqs.shape
    saliency = np.zeros((n, seq_len), dtype=np.float32)
    for pos in range(seq_len):
        perturbed = seqs.copy()
        perturbed[:, pos] = pad_token_id
        perturbed_probs = predict_fn(perturbed)
        saliency[:, pos] = np.abs(base_probs - perturbed_probs)
    print(f"[explain.sequence] saliency matrix shape {saliency.shape}, "
          f"mean |Δprob| per position: {saliency.mean(axis=0).round(3)}")
    return saliency


# ---- GNN explainer (line 6) ------------------------------------------
def explain_gnn_prediction(model, data, patient_node_id: int, drug_node_id: int, edge_index_full,
                            k_edges: int = 15):
    """Perturbation-based edge importance for one patient-drug prediction:
    for each of up to k_edges incident on the patient or drug node, remove
    it, re-run the model, and record how much the compatibility score
    moves. Larger |Δscore| = more influential edge (same principle as
    GNNExplainer's learned edge mask, computed here by direct search
    instead of a learned mask, so it needs no extra library)."""
    import torch

    model.eval()
    with torch.no_grad():
        z = model(data.x, data.edge_index)
        base_score = torch.sigmoid((z[patient_node_id] * z[drug_node_id]).sum()).item()

    ei = edge_index_full.numpy() if hasattr(edge_index_full, "numpy") else np.asarray(edge_index_full)
    incident_mask = (ei[0] == patient_node_id) | (ei[1] == patient_node_id) | \
                     (ei[0] == drug_node_id) | (ei[1] == drug_node_id)
    incident_edges = np.where(incident_mask)[0][:k_edges]

    results = []
    for e in incident_edges:
        keep_mask = np.ones(ei.shape[1], dtype=bool)
        keep_mask[e] = False
        perturbed_ei = torch.tensor(ei[:, keep_mask], dtype=torch.long)
        with torch.no_grad():
            z_p = model(data.x, perturbed_ei)
            score_p = torch.sigmoid((z_p[patient_node_id] * z_p[drug_node_id]).sum()).item()
        results.append({
            "edge": (int(ei[0, e]), int(ei[1, e])),
            "delta_score": base_score - score_p,
        })

    results.sort(key=lambda r: abs(r["delta_score"]), reverse=True)
    print(f"[explain.gnn] base_score={base_score:.3f}; top influential edges:")
    for r in results[:5]:
        print(f"    edge {r['edge']}  Δscore={r['delta_score']:+.3f}")
    return base_score, results


# ---- Report assembly (lines 7-12) ------------------------------------
def build_explanation_report(patient_id: str, drug_scores: list, tabular_importances: pd.Series,
                              gene_hits: list, allergy_hits: list) -> dict:
    """Assembles everything into one clinician-facing report: ranked
    influential features, compatible/contraindicated drug lists, and a
    confidence + evidence line per drug."""
    compatible = [d for d in drug_scores if d["status"] == "compatible"]
    incompatible = [d for d in drug_scores if d["status"] == "incompatible"]

    report = {
        "patient_id": patient_id,
        "top_clinical_features": tabular_importances.head(5).to_dict(),
        "significant_genes": gene_hits,
        "significant_allergies": allergy_hits,
        "compatible_drugs": compatible,
        "incompatible_drugs": incompatible,
    }
    print(f"\n[explain.report] patient={patient_id}")
    print(f"  significant genes: {gene_hits}")
    print(f"  significant allergies: {allergy_hits}")
    print(f"  compatible drugs: {[d['drug'] for d in compatible]}")
    print(f"  incompatible drugs: {[d['drug'] for d in incompatible]}")
    return report
