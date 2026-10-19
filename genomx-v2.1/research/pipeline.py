"""
pipeline.py
=================================================================
Orchestrates the full research-grade GenomX architecture end-to-end:

  Clinical data ─┬─> Random Forest (Alg 1) ─┐
                 └─> XGBoost (Alg 2) ────────┤
  Genomic seqs ──┬─> CNN (Alg 3) ────────────┤─> Fusion Network (Alg 6)
                 └─> Bi-LSTM (Alg 4) ────────┤        │
  Clinical+genomic─> Autoencoder (Alg 5) ────┘        │
                                                       ▼
                                     Knowledge Graph (Alg 7)
                                                       │
                                       patient nodes get fused embeddings
                                                       ▼
                                     Graph Neural Network (Alg 8)
                                                       │
                                     Explainable AI layer (Alg 9)
                                                       ▼
                                  Personalized drug recommendation

Run:
    python pipeline.py --epochs 60
=================================================================
"""

import argparse
import os
import numpy as np
import pandas as pd
import torch

from data_synthetic import generate_all, DRUG_CATALOG, ALLERGY_DRUG_BIAS
from genomic_encoding import build_vocab, encode_sequences
from models.random_forest_model import (
    load_dataset as rf_load, preprocess as rf_preprocess, split_dataset as rf_split,
    train_random_forest, evaluate as rf_evaluate, feature_importances,
)
from models.xgboost_model import (
    preprocess as xgb_preprocess, split_dataset as xgb_split, train_xgboost, evaluate as xgb_evaluate,
)
from models.cnn_model import train_cnn, get_embeddings as cnn_embeddings
from models.bilstm_model import train_bilstm, get_embeddings as bilstm_embeddings
from models.autoencoder_model import train_autoencoder, get_latent_embeddings
from models.fusion_model import train_fusion, get_fused_embeddings, evaluate_fusion
from splits import holdout_indices, stacked_proba
from knowledge_graph import build_knowledge_graph, visualize_graph
from gnn_model import (
    convert_to_pytorch_geometric_format, build_link_prediction_splits, train_gnn, evaluate_gnn,
)
from explainability import explain_tabular_model, build_explanation_report


def main():
    parser = argparse.ArgumentParser(description="GenomX research-grade multi-model pipeline (Algorithms 1-9)")
    parser.add_argument("--data-dir", type=str, default="data")
    parser.add_argument("--out-dir", type=str, default="outputs")
    parser.add_argument("--n-patients", type=int, default=400)
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--gnn-epochs", type=int, default=80)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--patient-id", type=str, default="P000001")
    parser.add_argument("--allergies", type=str, default="PENICILLIN")
    parser.add_argument("--regenerate-data", action="store_true",
                         help="regenerate the synthetic dataset even if data-dir already has one")
    args = parser.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    # ---------------------------------------------------------------
    # 0. Data
    # ---------------------------------------------------------------
    clinical_path = os.path.join(args.data_dir, "clinical_data.csv")
    if args.regenerate_data or not os.path.exists(clinical_path):
        print("\n=== 0. GENERATING SYNTHETIC MULTI-MODAL DATASET ===")
        generate_all(out_dir=args.data_dir, n_patients=args.n_patients, seed=args.seed)

    clinical_df = pd.read_csv(clinical_path)
    genomic_df = pd.read_csv(os.path.join(args.data_dir, "genomic_variants.csv"))
    pda_df = pd.read_csv(os.path.join(args.data_dir, "patient_drug_allergy.csv"))
    drug_gene_df = pd.read_csv(os.path.join(args.data_dir, "drug_gene_metabolism.csv"))
    gene_allergy_df = pd.read_csv(os.path.join(args.data_dir, "gene_allergy_association.csv"))

    # ---------------------------------------------------------------
    # 1. Random Forest baseline
    # ---------------------------------------------------------------
    print("\n=== 1. RANDOM FOREST (Algorithm 1) ===")
    rf_df, rf_features, rf_encoders, rf_scaler = rf_preprocess(rf_load(clinical_path))
    rf_X_train, rf_X_test, rf_y_train, rf_y_test = rf_split(rf_df, rf_features, seed=args.seed)
    rf_model = train_random_forest(rf_X_train, rf_y_train, seed=args.seed)
    rf_metrics = rf_evaluate(rf_model, rf_X_test, rf_y_test)
    rf_importances = feature_importances(rf_model, rf_features)
    rf_y_all = rf_df["adr_risk"].values
    train_idx, test_idx = holdout_indices(rf_y_all, seed=args.seed)   # ONE split shared by every model
    # out-of-fold on train rows / held-out on test rows -> no in-sample leakage into fusion
    rf_proba_all = stacked_proba(rf_model, rf_df[rf_features].values, rf_y_all, train_idx, test_idx, seed=args.seed)

    # ---------------------------------------------------------------
    # 2. XGBoost (with automatic sklearn fallback)
    # ---------------------------------------------------------------
    print("\n=== 2. XGBOOST (Algorithm 2) ===")
    xgb_df, xgb_features, xgb_encoders, xgb_scaler = xgb_preprocess(pd.read_csv(clinical_path))
    xgb_X_train, xgb_X_test, xgb_y_train, xgb_y_test = xgb_split(xgb_df, xgb_features, seed=args.seed)
    xgb_model = train_xgboost(xgb_X_train, xgb_y_train, seed=args.seed)
    xgb_metrics = xgb_evaluate(xgb_model, xgb_X_test, xgb_y_test)
    xgb_proba_all = stacked_proba(xgb_model, xgb_df[xgb_features].values, xgb_df["adr_risk"].values,
                                  train_idx, test_idx, seed=args.seed)

    # ---------------------------------------------------------------
    # 3 & 4. Genomic sequence models
    # ---------------------------------------------------------------
    print("\n=== 3. CNN (Algorithm 3) ===")
    vocab = build_vocab(genomic_df)
    seq_pids, seqs = encode_sequences(genomic_df, vocab)
    # re-order sequences to the RF row order so every model shares the same split indices
    ordered_patients = rf_df["patient_id"].tolist()
    _pos = {pid: i for i, pid in enumerate(seq_pids)}
    seqs = seqs[[_pos[p] for p in ordered_patients]]
    seq_pids = ordered_patients
    seq_labels = rf_df["adr_risk"].values
    cnn_model, cnn_history, cnn_metrics = train_cnn(seqs, seq_labels, vocab_size=len(vocab), epochs=args.epochs, seed=args.seed)
    cnn_emb_all = cnn_embeddings(cnn_model, seqs)

    print("\n=== 4. Bi-LSTM (Algorithm 4) ===")
    bilstm_model, bilstm_history, bilstm_metrics = train_bilstm(seqs, seq_labels, vocab_size=len(vocab), epochs=args.epochs, seed=args.seed)
    bilstm_emb_all = bilstm_embeddings(bilstm_model, seqs)

    # ---------------------------------------------------------------
    # 5. Autoencoder over the clinical feature matrix
    # ---------------------------------------------------------------
    print("\n=== 5. AUTOENCODER (Algorithm 5) ===")
    ae_X = rf_df[rf_features].values.astype(np.float32)
    ae_model, ae_history = train_autoencoder(ae_X, epochs=args.epochs, seed=args.seed)
    ae_emb_all = get_latent_embeddings(ae_model, ae_X)

    # ---------------------------------------------------------------
    # 6. Fusion network
    #    (align everything to the rf_df patient ordering -- rf/xgb/ae all
    #    already follow that order; genomic embeddings are reindexed to it)
    # ---------------------------------------------------------------
    print("\n=== 6. FUSION NETWORK (Algorithm 6) ===")
    cnn_aligned = cnn_emb_all
    bilstm_aligned = bilstm_emb_all

    modality_arrays = {
        "rf": rf_proba_all.reshape(-1, 1).astype(np.float32),
        "xgb": xgb_proba_all.reshape(-1, 1).astype(np.float32),
        "cnn": cnn_aligned.astype(np.float32),
        "bilstm": bilstm_aligned.astype(np.float32),
        "autoencoder": ae_emb_all.astype(np.float32),
    }
    fusion_labels = rf_df["adr_risk"].values
    fusion_model, fusion_history = train_fusion(modality_arrays, fusion_labels, epochs=args.epochs,
                                                seed=args.seed, train_idx=train_idx)
    fusion_metrics = evaluate_fusion(fusion_model, modality_arrays, fusion_labels, test_idx)
    fused_emb_all, attn_weights = get_fused_embeddings(fusion_model, modality_arrays)
    patient_embeddings = {pid: fused_emb_all[i] for i, pid in enumerate(ordered_patients)}
    print(f"[pipeline] mean modality attention weights: "
          f"{{k: round(float(v), 3) for k, v in zip(modality_arrays.keys(), attn_weights.mean(axis=0))}}")

    # ---------------------------------------------------------------
    # 7. Knowledge graph
    # ---------------------------------------------------------------
    print("\n=== 7. KNOWLEDGE GRAPH (Algorithm 7) ===")
    kg = build_knowledge_graph(clinical_df, genomic_df, pda_df, drug_gene_df, gene_allergy_df)
    visualize_graph(kg, out_path=os.path.join(args.out_dir, "knowledge_graph.png"))

    # ---------------------------------------------------------------
    # 8. GNN over the graph, seeded with fused patient embeddings
    # ---------------------------------------------------------------
    print("\n=== 8. GRAPH NEURAL NETWORK (Algorithm 8) ===")
    embed_dim = fused_emb_all.shape[1]
    data = convert_to_pytorch_geometric_format(kg, patient_embeddings, embed_dim)
    splits = build_link_prediction_splits(kg, seed=args.seed)
    gnn_model, gnn_history = train_gnn(data, splits, epochs=args.gnn_epochs, seed=args.seed)
    test_idx, test_labels = splits["test"]
    gnn_metrics = evaluate_gnn(gnn_model, data, test_idx, test_labels)

    # ---------------------------------------------------------------
    # 9. Explainability + final recommendation for the demo patient
    # ---------------------------------------------------------------
    print("\n=== 9. EXPLAINABLE AI + RECOMMENDATION (Algorithm 9) ===")
    rf_importance_series = explain_tabular_model(rf_model, rf_X_test, rf_y_test, rf_features, n_repeats=15, seed=args.seed)

    gnn_model.eval()
    with torch.no_grad():
        z = gnn_model(data.x, data.edge_index)

    known_allergies = [a.strip() for a in args.allergies.split(",") if a.strip()]
    patient_key = ("patient", args.patient_id)
    if patient_key not in kg.node_id:
        print(f"[pipeline] patient_id '{args.patient_id}' not found; using '{ordered_patients[0]}' instead.")
        args.patient_id = ordered_patients[0]
        patient_key = ("patient", args.patient_id)
    patient_node = kg.node_id[patient_key]
    z_patient = z[patient_node]

    drug_scores = []
    for drug in DRUG_CATALOG:
        drug_node = kg.node_id[("drug", drug)]
        score = torch.sigmoid((z_patient * z[drug_node]).sum()).item()
        explanation = "no direct allergy edge; score from learned graph embedding"
        for allergy in known_allergies:
            if allergy in ALLERGY_DRUG_BIAS and drug in ALLERGY_DRUG_BIAS[allergy]:
                explanation = f"drug is directly linked to documented allergy '{allergy}' in the knowledge graph"
                score = max(score, 0.9)
        drug_scores.append({
            "drug": drug, "incompatibility_score": round(score, 3),
            "status": "incompatible" if score >= 0.5 else "compatible",
            "explanation": explanation,
        })
    drug_scores.sort(key=lambda r: r["incompatibility_score"], reverse=True)

    patient_variants = genomic_df[genomic_df["patient_id"] == args.patient_id]
    from data_synthetic import RISK_ALLELES
    gene_hits = patient_variants[patient_variants["variant"].isin(RISK_ALLELES)]["gene"].tolist()
    allergy_hits = known_allergies
    report = build_explanation_report(args.patient_id, drug_scores, rf_importance_series, gene_hits, allergy_hits)

    # ---------------------------------------------------------------
    # Summary
    # ---------------------------------------------------------------
    print("\n=== SUMMARY ===")
    print(f"Random Forest : {rf_metrics}")
    print(f"XGBoost       : {xgb_metrics}")
    print(f"CNN           : {cnn_metrics}")
    print(f"Bi-LSTM       : {bilstm_metrics}")
    print(f"Fusion        : {fusion_metrics}")
    print(f"GNN           : {gnn_metrics}")

    torch.save({
        "gnn_state_dict": gnn_model.state_dict(),
        "fusion_state_dict": fusion_model.state_dict() if hasattr(fusion_model, "state_dict") else None,
        "embed_dim": embed_dim,
    }, os.path.join(args.out_dir, "genomx_full_model.pt"))
    print(f"\n[pipeline] saved model bundle to {os.path.join(args.out_dir, 'genomx_full_model.pt')}")


if __name__ == "__main__":
    main()
