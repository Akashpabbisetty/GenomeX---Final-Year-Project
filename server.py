"""
server.py
=================================================================
Real backend for the GenomX Advisor dashboard: trains the full
multi-modal pipeline once at startup, then serves per-patient drug
recommendations by actually running each new patient through it --
replacing the frontend's old sequential rule chain (patient -> genes
-> allergies -> drug -> rule -> recommendation) with the parallel
architecture the project was designed around:

    Genes + Age + Diagnosis + Organ function + Pregnancy +
    Current medicines + Drug interactions + Clinical guidelines
                            |
                  (evaluated simultaneously,
                   fused via attention, scored
                   via a graph neural network)
                            v
                   Final recommendation

Pipeline per request:
  1. Random Forest + XGBoost  -> two independent ADR-risk probabilities
     from clinical tabular features (age, sex, organ function, diagnosis,
     pregnancy, current medications)
  2. CNN + Bi-LSTM            -> genomic embeddings from the patient's
     checked gene markers
  3. Autoencoder               -> a label-free latent compression of the
     same clinical features
  4. Fusion Network (attention)-> combines all five modality outputs into
     one patient embedding
  5. Knowledge Graph + GNN    -> the new patient is inserted as a node
     connected to their checked gene/allergy nodes, and a trained GCN
     scores compatibility against every drug node via link prediction
  6. Clinical-guideline hard floor -> CPIC/allergy contraindications and
     organ-function/pregnancy/age/interaction rules set a non-negotiable
     minimum severity on top of the model's score (see clinical_rules.py)

Run:
    pip install -r requirements.txt
    uvicorn server:app --host 127.0.0.1 --port 8420
=================================================================
"""

import os
import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from data_synthetic import (
    generate_all, GENE_PANEL, ALLERGY_CATALOG, DRUG_CATALOG,
)
from genomic_encoding import build_vocab, encode_sequences
from models.random_forest_model import (
    load_dataset as rf_load, preprocess as rf_preprocess, split_dataset as rf_split,
    train_random_forest, evaluate as rf_evaluate, CATEGORICAL_COLS, NUMERIC_COLS,
)
from models.xgboost_model import preprocess as xgb_preprocess, train_xgboost
from models.cnn_model import train_cnn, GenomicCNN
from models.bilstm_model import train_bilstm, GenomicBiLSTM
from models.autoencoder_model import train_autoencoder, FeatureAutoencoder
from models.fusion_model import train_fusion, FusionNetwork
from knowledge_graph import build_knowledge_graph
from gnn_model import (
    generate_edge_index, create_node_features, build_link_prediction_splits,
    train_gnn, DrugRecommendationGNN,
)
from clinical_rules import compute_overall_score

GENE_CODE_MAP = {
    "HLAB5701": "HLA-B*57:01", "HLAB5801": "HLA-B*58:01", "CYP2C93": "CYP2C9*3",
    "TPMTLOW": "TPMT/NUDT15", "SLCO1B1": "SLCO1B1", "CYP2C19PM": "CYP2C19*2/*3",
    "CYP2D6UM": "CYP2D6 UM", "CYP2D6PM": "CYP2D6 PM", "VKORC1": "VKORC1",
    "DPYD": "DPYD", "UGT1A1": "UGT1A1*28", "HLAB1502": "HLA-B*15:02",
}
ALLERGY_CODE_MAP = {"PENICILLIN": "β-lactam", "SULFA": "Sulfonamide", "NSAID": "NSAID"}

EPOCHS = 40  # kept modest so server startup finishes in a reasonable time
STATE = {}  # populated once at startup; see train_everything()


# =================================================================
# One-time training at server startup
# =================================================================
def train_everything(data_dir: str = "data", seed: int = 42):
    print("[startup] generating / loading synthetic training data...")
    if not os.path.exists(os.path.join(data_dir, "clinical_data.csv")):
        generate_all(out_dir=data_dir, seed=seed)
    clinical_df = pd.read_csv(os.path.join(data_dir, "clinical_data.csv"))
    genomic_df = pd.read_csv(os.path.join(data_dir, "genomic_variants.csv"))
    pda_df = pd.read_csv(os.path.join(data_dir, "patient_drug_allergy.csv"))
    drug_gene_df = pd.read_csv(os.path.join(data_dir, "drug_gene_metabolism.csv"))
    gene_allergy_df = pd.read_csv(os.path.join(data_dir, "gene_allergy_association.csv"))

    print("[startup] 1/6 training Random Forest...")
    rf_df, rf_features, rf_encoders, rf_scaler = rf_preprocess(rf_load(os.path.join(data_dir, "clinical_data.csv")))
    rf_X_train, rf_X_test, rf_y_train, rf_y_test = rf_split(rf_df, rf_features, seed=seed)
    rf_model = train_random_forest(rf_X_train, rf_y_train, seed=seed)
    rf_evaluate(rf_model, rf_X_test, rf_y_test)
    rf_proba_all = rf_model.predict_proba(rf_df[rf_features].values)[:, 1]

    print("[startup] 2/6 training XGBoost...")
    xgb_df, xgb_features, xgb_encoders, xgb_scaler = xgb_preprocess(pd.read_csv(os.path.join(data_dir, "clinical_data.csv")))
    xgb_model = train_xgboost(xgb_df[xgb_features].values, xgb_df["adr_risk"].values, seed=seed)
    xgb_proba_all = xgb_model.predict_proba(xgb_df[xgb_features].values)[:, 1]

    print("[startup] 3/6 training CNN + Bi-LSTM on genomic sequences...")
    vocab = build_vocab(genomic_df)
    seq_pids, seqs = encode_sequences(genomic_df, vocab)
    seq_labels = clinical_df.set_index("patient_id").loc[seq_pids, "adr_risk"].values
    cnn_model, _, _ = train_cnn(seqs, seq_labels, vocab_size=len(vocab), epochs=EPOCHS, seed=seed)
    bilstm_model, _, _ = train_bilstm(seqs, seq_labels, vocab_size=len(vocab), epochs=EPOCHS, seed=seed)

    print("[startup] 4/6 training Autoencoder + Fusion network...")
    ae_X = rf_df[rf_features].values.astype(np.float32)
    ae_model, _ = train_autoencoder(ae_X, epochs=EPOCHS, seed=seed)

    cnn_model.eval(); bilstm_model.eval(); ae_model.eval()
    with torch.no_grad():
        seq_t = torch.tensor(seqs, dtype=torch.long)
        _, cnn_emb_all = cnn_model(seq_t)
        _, bilstm_emb_all = bilstm_model(seq_t)
        _, ae_emb_all = ae_model(torch.tensor(ae_X, dtype=torch.float))
    cnn_emb_all = cnn_emb_all.numpy(); bilstm_emb_all = bilstm_emb_all.numpy(); ae_emb_all = ae_emb_all.numpy()

    ordered_patients = rf_df["patient_id"].tolist()
    seq_pos = {pid: i for i, pid in enumerate(seq_pids)}
    cnn_aligned = np.stack([cnn_emb_all[seq_pos[p]] for p in ordered_patients])
    bilstm_aligned = np.stack([bilstm_emb_all[seq_pos[p]] for p in ordered_patients])

    modality_arrays = {
        "rf": rf_proba_all.reshape(-1, 1).astype(np.float32),
        "xgb": xgb_proba_all.reshape(-1, 1).astype(np.float32),
        "cnn": cnn_aligned.astype(np.float32),
        "bilstm": bilstm_aligned.astype(np.float32),
        "autoencoder": ae_emb_all.astype(np.float32),
    }
    fusion_model, _ = train_fusion(modality_arrays, rf_df["adr_risk"].values, epochs=EPOCHS, seed=seed)
    fusion_model.eval()
    with torch.no_grad():
        tensors = {k: torch.tensor(v, dtype=torch.float) for k, v in modality_arrays.items()}
        _, fused_all, _ = fusion_model(tensors)
    fused_all = fused_all.numpy()
    patient_embeddings = {pid: fused_all[i] for i, pid in enumerate(ordered_patients)}
    embed_dim = fused_all.shape[1]

    print("[startup] 5/6 building knowledge graph + training GNN...")
    kg = build_knowledge_graph(clinical_df, genomic_df, pda_df, drug_gene_df, gene_allergy_df)
    edge_index = generate_edge_index(kg.G)
    x = create_node_features_with_fusion(kg, patient_embeddings, embed_dim)
    from torch_geometric.data import Data
    data = Data(x=x, edge_index=edge_index)
    splits = build_link_prediction_splits(kg, seed=seed)
    gnn_model, _ = train_gnn(data, splits, epochs=EPOCHS * 2, seed=seed)

    print("[startup] 6/6 caching state for inference...")
    STATE.update({
        "rf_model": rf_model, "rf_features": rf_features, "rf_encoders": rf_encoders, "rf_scaler": rf_scaler,
        "xgb_model": xgb_model, "xgb_features": xgb_features, "xgb_encoders": xgb_encoders, "xgb_scaler": xgb_scaler,
        "cnn_model": cnn_model, "bilstm_model": bilstm_model, "ae_model": ae_model, "fusion_model": fusion_model,
        "gnn_model": gnn_model, "vocab": vocab, "kg": kg, "data": data, "embed_dim": embed_dim,
        "clinical_df": clinical_df,
    })
    print("[startup] ready.")


def create_node_features_with_fusion(kg, patient_embeddings, embed_dim):
    from gnn_model import create_node_features as _cnf
    return _cnf(kg, patient_embeddings, embed_dim)


# =================================================================
# Per-request inference for a NEW patient (inductive GNN scoring)
# =================================================================
def build_clinical_row(patient: dict) -> pd.DataFrame:
    """Approximates lab values from the categorical organ-function
    selections the frontend actually collects (it doesn't have raw
    creatinine/ALT/eGFR fields), using the same generative assumptions
    as data_synthetic.py so the RF/XGBoost models see a realistic,
    consistently-scaled input."""
    kidney = patient.get("renal", "normal")
    liver = patient.get("hepatic", "normal")
    creatinine = 2.1 if kidney == "impaired" else 1.0
    alt = 70 if liver == "impaired" else 25
    egfr = 45 if kidney == "impaired" else 90

    diagnosis_text = (patient.get("diagnosis") or "").lower()
    diagnosis_map = {
        "diabetes": "Type 2 Diabetes", "hypertension": "Hypertension", "blood pressure": "Hypertension",
        "atrial": "Atrial Fibrillation", "hiv": "HIV", "gout": "Gout", "epilep": "Epilepsy",
        "seizure": "Epilepsy", "depress": "Depression", "cancer": "Cancer (solid tumor)",
        "tumor": "Cancer (solid tumor)", "cholesterol": "Dyslipidemia", "lipid": "Dyslipidemia",
    }
    diagnosis_cat = "No diagnosis on file"
    for kw, cat in diagnosis_map.items():
        if kw in diagnosis_text:
            diagnosis_cat = cat
            break

    current_meds = patient.get("current_meds") or ""
    on_warfarin = int("warfarin" in current_meds.lower())

    return pd.DataFrame([{
        "sex": patient.get("sex") or "Female", "liver_function": liver, "kidney_function": kidney,
        "diagnosis": diagnosis_cat, "age": patient.get("age") or 45,
        "weight_kg": patient.get("weight") or 70, "height_cm": patient.get("height") or 170,
        "creatinine": creatinine, "alt": alt, "egfr": egfr,
        "n_allergies": len(patient.get("allergies", [])), "pgx_risk_allele_count": len(patient.get("genes", [])),
        "pregnant": int(bool(patient.get("pregnant"))), "on_warfarin": on_warfarin,
    }])


def encode_with_fitted(df: pd.DataFrame, feature_cols: list, encoders: dict, scaler, numeric_cols: list, categorical_cols: list) -> np.ndarray:
    row = df.copy()
    for col in categorical_cols:
        le = encoders[col]
        val = row.at[0, col]
        if val not in le.classes_:
            val = le.classes_[0]  # unseen category -> fall back to a known class rather than error
        row.at[0, col + "_enc"] = le.transform([val])[0]
    scaled = scaler.transform(row[numeric_cols])
    for i, col in enumerate(numeric_cols):
        row.at[0, col + "_scaled"] = scaled[0, i]
    return row[feature_cols].values.astype(np.float32)


def recommend_for_patient(patient: dict) -> dict:
    checked_genes = set(patient.get("genes", []))
    checked_allergies = set(patient.get("allergies", []))

    clinical_row = build_clinical_row(patient)
    rf_x = encode_with_fitted(clinical_row, STATE["rf_features"], STATE["rf_encoders"], STATE["rf_scaler"], NUMERIC_COLS, CATEGORICAL_COLS)
    xgb_x = encode_with_fitted(clinical_row, STATE["xgb_features"], STATE["xgb_encoders"], STATE["xgb_scaler"], NUMERIC_COLS, CATEGORICAL_COLS)
    rf_prob = STATE["rf_model"].predict_proba(rf_x)[:, 1]
    xgb_prob = STATE["xgb_model"].predict_proba(xgb_x)[:, 1]

    seq = np.array([[1 if g in checked_genes else 0 for g in GENE_PANEL]])
    # translate 0/1 into this patient's vocab tokens ("GENE::present"/"GENE::absent")
    vocab = STATE["vocab"]
    token_seq = np.array([[
        vocab.get(f"{gene}::{'present' if seq[0][i] else 'absent'}", vocab["<UNK>"])
        for i, gene in enumerate(GENE_PANEL)
    ]])

    cnn_model, bilstm_model, ae_model, fusion_model = STATE["cnn_model"], STATE["bilstm_model"], STATE["ae_model"], STATE["fusion_model"]
    cnn_model.eval(); bilstm_model.eval(); ae_model.eval(); fusion_model.eval()
    with torch.no_grad():
        seq_t = torch.tensor(token_seq, dtype=torch.long)
        _, cnn_emb = cnn_model(seq_t)
        _, bilstm_emb = bilstm_model(seq_t)
        _, ae_emb = ae_model(torch.tensor(rf_x, dtype=torch.float))
        tensors = {
            "rf": torch.tensor(rf_prob.reshape(1, 1), dtype=torch.float),
            "xgb": torch.tensor(xgb_prob.reshape(1, 1), dtype=torch.float),
            "cnn": cnn_emb, "bilstm": bilstm_emb, "autoencoder": ae_emb,
        }
        _, fused, weights = fusion_model(tensors)
    fused_np = fused.numpy()[0]
    weights_np = weights.numpy()[0]

    # ---- inductive GNN scoring: insert this patient as a temporary node ----
    kg = STATE["kg"]
    data = STATE["data"]
    embed_dim = STATE["embed_dim"]
    new_node_id = data.x.shape[0]

    new_row = torch.tensor(fused_np, dtype=torch.float).unsqueeze(0)
    x_expanded = torch.cat([data.x, new_row], dim=0)

    extra_edges = []
    for gene_id in checked_genes:
        key = ("variant", f"{gene_id}::present")
        if key in kg.node_id:
            extra_edges.append((new_node_id, kg.node_id[key]))
    for allergy_id in checked_allergies:
        key = ("allergy", allergy_id)
        if key in kg.node_id:
            extra_edges.append((new_node_id, kg.node_id[key]))

    if extra_edges:
        extra = torch.tensor(extra_edges, dtype=torch.long).T
        extra_both = torch.cat([extra, extra.flip(0)], dim=1)
        edge_index_expanded = torch.cat([data.edge_index, extra_both], dim=1)
    else:
        edge_index_expanded = data.edge_index

    gnn_model = STATE["gnn_model"]
    gnn_model.eval()
    with torch.no_grad():
        z = gnn_model(x_expanded, edge_index_expanded)
    z_patient = z[new_node_id]

    results = []
    for drug in DRUG_CATALOG:
        drug_key = ("drug", drug)
        if drug_key not in kg.node_id:
            continue
        drug_idx = kg.node_id[drug_key]
        with torch.no_grad():
            model_score = float(torch.sigmoid((z_patient * z[drug_idx]).sum()).item())

        score_result = compute_overall_score(
            drug, {
                "renal": patient.get("renal"), "hepatic": patient.get("hepatic"),
                "pregnant": patient.get("pregnant"), "age": patient.get("age"),
                "current_meds": patient.get("current_meds"), "diagnosis": patient.get("diagnosis"),
            },
            checked_genes, checked_allergies, GENE_CODE_MAP, ALLERGY_CODE_MAP, model_score=model_score,
        )

        results.append({
            "name": drug,
            "overall_score": score_result["overall_score"],
            "severity": score_result["severity"], "severity_label": score_result["severity_label"],
            "recommendation": score_result["recommendation"], "factors": score_result["factors"],
            "interactions": score_result["interactions"],
            "confidence": score_result["overall_score"],  # kept for any older frontend code paths
            "model_score": round(model_score, 4),
        })

    results.sort(key=lambda r: r["overall_score"])  # lowest safety score (most concerning) first
    return {
        "results": results,
        "modality_weights": {
            name: round(float(w), 3) for name, w in zip(["rf", "xgb", "cnn", "bilstm", "autoencoder"], weights_np)
        },
    }


# =================================================================
# FastAPI app
# =================================================================
app = FastAPI(title="GenomX Advisor Backend")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


class PatientInput(BaseModel):
    name: str | None = None
    age: float | None = None
    sex: str | None = None
    weight: float | None = None
    height: float | None = None
    diagnosis: str | None = None
    current_meds: str | None = None
    renal: str | None = "normal"
    hepatic: str | None = "normal"
    pregnant: bool | None = False
    genes: list[str] = []
    allergies: list[str] = []


@app.on_event("startup")
def _startup():
    train_everything()


@app.get("/health")
def health():
    return {"status": "ready" if STATE else "training", "drugs": len(DRUG_CATALOG), "genes": len(GENE_PANEL)}


@app.post("/recommend")
def recommend(patient: PatientInput):
    if not STATE:
        return {"error": "model still training, try again shortly"}
    return recommend_for_patient(patient.dict())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8420)
