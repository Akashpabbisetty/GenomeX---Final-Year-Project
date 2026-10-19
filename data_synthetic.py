"""
data_synthetic.py
=================================================================
Generates a synthetic multi-modal dataset with the same *shape* as
real-world pharmacogenomic data. This version's gene, allergy, and
drug catalogs are kept in exact 1:1 sync with the frontend
(genomx-advisor.html / app.js) so every drug and marker the user sees
in the UI has a real, matching node in the backend's knowledge graph
and training data.

Produces, under --out-dir (default data/):
  clinical_data.csv          patient-level tabular features + adr_risk label   (RF/XGBoost input)
  genomic_variants.csv       long-format patient x gene marker (present/absent) (CNN/Bi-LSTM input)
  drug_gene_metabolism.csv   reference: which gene affects which drug           (KG edge: Drug-metabolized-by-Gene)
  gene_allergy_association.csv reference: which gene is linked to which ADR     (KG edge: Gene-associated-with-Allergy)
  patient_drug_allergy.csv   documented patient-drug-allergy reactions          (KG edge: Drug-causes-ADR / Patient-has-Allergy)
=================================================================
"""

import os
import numpy as np
import pandas as pd

# ---- Gene markers: exactly the 12 checkboxes in app.js GENES -----------
# Modeled as binary present/absent flags (not multi-allele categoricals)
# so they map 1:1 onto the frontend's checkbox model.
GENE_PANEL = [
    "HLAB5701", "HLAB5801", "CYP2C93", "TPMTLOW", "SLCO1B1", "CYP2C19PM",
    "CYP2D6UM", "CYP2D6PM", "VKORC1", "DPYD", "UGT1A1", "HLAB1502",
]
# Background prevalence of each risk marker (loosely realistic, not clinical fact)
GENE_PREVALENCE = {
    "HLAB5701": 0.06, "HLAB5801": 0.08, "CYP2C93": 0.10, "TPMTLOW": 0.05,
    "SLCO1B1": 0.15, "CYP2C19PM": 0.15, "CYP2D6UM": 0.04, "CYP2D6PM": 0.08,
    "VKORC1": 0.20, "DPYD": 0.04, "UGT1A1": 0.10, "HLAB1502": 0.05,
}
RISK_ALLELES = {"present"}

# ---- Allergies: exactly the 3 checkboxes in app.js ALLERGIES -----------
ALLERGY_CATALOG = ["PENICILLIN", "SULFA", "NSAID"]
# Additional gene-associated ADR phenotype labels, used only for
# Gene-associated-with-Allergy knowledge-graph edges (not patient checkboxes).
GENE_PHENOTYPES = {
    "HLAB5701": "Abacavir hypersensitivity", "HLAB5801": "Allopurinol hypersensitivity",
    "CYP2C93": "Phenytoin toxicity", "TPMTLOW": "Thiopurine myelosuppression",
    "SLCO1B1": "Statin myopathy", "CYP2C19PM": "Reduced clopidogrel activation / drug exposure changes",
    "CYP2D6UM": "Opioid toxicity", "CYP2D6PM": "Reduced prodrug activation / elevated drug exposure",
    "VKORC1": "Altered anticoagulant sensitivity", "DPYD": "Fluoropyrimidine toxicity",
    "UGT1A1": "Irinotecan-induced neutropenia", "HLAB1502": "Stevens-Johnson syndrome / TEN",
}

# ---- Drug catalog: exactly the 30 drugs in app.js DRUGS, same gene/allergy links ----
DRUG_GENE_METABOLISM = {
    "Abacavir": "HLAB5701", "Allopurinol": "HLAB5801", "Phenytoin": "CYP2C93",
    "Azathioprine": "TPMTLOW", "Simvastatin": "SLCO1B1", "Clopidogrel": "CYP2C19PM",
    "Codeine": "CYP2D6UM", "Warfarin": "VKORC1", "Voriconazole": "CYP2C19PM",
    "Tamoxifen": "CYP2D6PM", "Fluorouracil (5-FU)": "DPYD", "Capecitabine": "DPYD",
    "Irinotecan": "UGT1A1", "Carbamazepine": "HLAB1502", "Oxcarbazepine": "HLAB1502",
    "Citalopram": "CYP2C19PM", "Escitalopram": "CYP2C19PM", "Amitriptyline": "CYP2D6PM",
    "Atomoxetine": "CYP2D6PM", "Ondansetron": "CYP2D6UM", "Omeprazole": "CYP2C19PM",
    "Atorvastatin": "SLCO1B1", "Rosuvastatin": "SLCO1B1",
}
DRUG_ALLERGY_LINK = {
    "Amoxicillin": "PENICILLIN", "Trimethoprim-Sulfamethoxazole": "SULFA",
    "Ibuprofen": "NSAID", "Aspirin": "NSAID", "Cephalexin": "PENICILLIN",
}
NO_PGX_DRUGS = ["Metformin", "Levothyroxine"]  # no gene/allergy link, clinical-rule-only

DRUG_CATALOG = list(DRUG_GENE_METABOLISM.keys()) + list(DRUG_ALLERGY_LINK.keys()) + NO_PGX_DRUGS
assert len(DRUG_CATALOG) == 30, f"expected 30 drugs, got {len(DRUG_CATALOG)}"

ALLERGY_DRUG_BIAS = {}
for drug, allergy in DRUG_ALLERGY_LINK.items():
    ALLERGY_DRUG_BIAS.setdefault(allergy, []).append(drug)

DIAGNOSIS_CATEGORIES = [
    "Type 2 Diabetes", "Hypertension", "Atrial Fibrillation", "HIV", "Gout",
    "Epilepsy", "Depression", "Cancer (solid tumor)", "Dyslipidemia", "No diagnosis on file",
]


def _rng(seed):
    return np.random.default_rng(seed)


def generate_genomic_variants(n_patients: int, seed: int = 42) -> pd.DataFrame:
    """One row per patient x gene marker, long format ('present'/'absent'),
    pivoted into an ordered per-patient binary sequence for the CNN / Bi-LSTM
    models by genomic_encoding.py."""
    rng = _rng(seed)
    rows = []
    for i in range(n_patients):
        pid = f"P{str(i).zfill(6)}"
        for gene in GENE_PANEL:
            present = rng.random() < GENE_PREVALENCE[gene]
            rows.append({"patient_id": pid, "gene": gene, "variant": "present" if present else "absent"})
    return pd.DataFrame(rows)


def _patient_risk_flags(genomic_df: pd.DataFrame) -> pd.Series:
    genomic_df = genomic_df.copy()
    genomic_df["is_risk_allele"] = genomic_df["variant"].isin(RISK_ALLELES).astype(int)
    return genomic_df.groupby("patient_id")["is_risk_allele"].sum().rename("risk_allele_count")


def generate_clinical_data(n_patients: int, genomic_df: pd.DataFrame, seed: int = 42) -> pd.DataFrame:
    """Patient demographics, meds, labs, allergy history, pregnancy, and
    diagnosis, plus a synthetic adr_risk label that genuinely depends on
    renal/hepatic impairment, allergy count, PGx risk-allele count,
    pregnancy, and a same-drug-class interaction flag -- so every one of
    the features the multi-modal system is meant to evaluate simultaneously
    (genes + age + diagnosis + organ function + pregnancy + current
    medicines + drug interactions) actually carries real predictive signal,
    not just cosmetic columns."""
    rng = _rng(seed + 1)
    risk_counts = _patient_risk_flags(genomic_df)

    rows = []
    for i in range(n_patients):
        pid = f"P{str(i).zfill(6)}"
        age = int(np.clip(rng.normal(52, 18), 1, 95))
        sex = rng.choice(["Female", "Male"])
        weight = float(np.clip(rng.normal(75, 15), 35, 160))
        height = float(np.clip(rng.normal(168, 10), 140, 200))
        liver = rng.choice(["normal", "impaired"], p=[0.85, 0.15])
        kidney = rng.choice(["normal", "impaired"], p=[0.8, 0.2])
        diagnosis = rng.choice(DIAGNOSIS_CATEGORIES)
        n_meds = rng.integers(0, 4)
        current_meds = ",".join(rng.choice(DRUG_CATALOG, size=n_meds, replace=False)) if n_meds else ""
        on_warfarin = int("Warfarin" in current_meds)
        creatinine = float(np.clip(rng.normal(1.0 if kidney == "normal" else 2.1, 0.3), 0.4, 4.0))
        alt = float(np.clip(rng.normal(25 if liver == "normal" else 70, 10), 8, 200))
        egfr = float(np.clip(rng.normal(90 if kidney == "normal" else 45, 15), 10, 130))
        n_allergies = rng.integers(0, 3)
        allergies = ",".join(rng.choice(ALLERGY_CATALOG, size=n_allergies, replace=False)) if n_allergies else ""
        pregnant = int(sex == "Female" and age < 45 and rng.random() < 0.08)

        risk_count = int(risk_counts.get(pid, 0))
        logit = (
            -2.3 + 0.55 * (kidney == "impaired") + 0.45 * (liver == "impaired")
            + 0.35 * n_allergies + 0.30 * risk_count + 0.5 * pregnant + 0.4 * on_warfarin
            + 0.01 * (age - 50) / 10 + rng.normal(0, 0.6)
        )
        prob = 1 / (1 + np.exp(-logit))
        adr_risk = int(rng.random() < prob)

        rows.append({
            "patient_id": pid, "age": age, "sex": sex, "weight_kg": round(weight, 1),
            "height_cm": round(height, 1), "liver_function": liver, "kidney_function": kidney,
            "diagnosis": diagnosis, "current_medications": current_meds, "on_warfarin": on_warfarin,
            "creatinine": round(creatinine, 2), "alt": round(alt, 1), "egfr": round(egfr, 1),
            "allergy_history": allergies, "n_allergies": n_allergies, "pregnant": pregnant,
            "pgx_risk_allele_count": risk_count, "adr_risk": adr_risk,
        })
    return pd.DataFrame(rows)


def generate_patient_drug_allergy(n_patients: int, n_rows: int = 1800, seed: int = 42) -> pd.DataFrame:
    """Documented patient-drug-allergy reactions -- the positive
    (incompatible) label for the GNN's link-prediction task."""
    rng = _rng(seed + 2)
    patient_ids = [f"P{str(i).zfill(6)}" for i in range(n_patients)]
    rows = []
    for _ in range(n_rows):
        patient = rng.choice(patient_ids)
        allergy = rng.choice(ALLERGY_CATALOG)
        biased_drugs = ALLERGY_DRUG_BIAS.get(allergy)
        drug = rng.choice(biased_drugs) if biased_drugs and rng.random() < 0.7 else rng.choice(DRUG_CATALOG)
        rows.append({
            "patientunitstayid": patient, "drugname": drug, "allergyname": allergy,
            "allergyoffset": int(rng.integers(-500, 0)), "allergyenteredoffset": int(rng.integers(0, 500)),
        })
    return pd.DataFrame(rows).drop_duplicates(subset=["patientunitstayid", "drugname", "allergyname"])


def generate_reference_tables():
    drug_gene = pd.DataFrame(
        [{"drugname": d, "gene": g} for d, g in DRUG_GENE_METABOLISM.items()]
    )
    gene_allergy = pd.DataFrame(
        [{"gene": g, "allergyname": phenotype} for g, phenotype in GENE_PHENOTYPES.items()]
    )
    return drug_gene, gene_allergy


def generate_all(out_dir: str = "data", n_patients: int = 500, seed: int = 42):
    os.makedirs(out_dir, exist_ok=True)
    genomic_df = generate_genomic_variants(n_patients, seed=seed)
    clinical_df = generate_clinical_data(n_patients, genomic_df, seed=seed)
    pda_df = generate_patient_drug_allergy(n_patients, seed=seed)
    drug_gene_df, gene_allergy_df = generate_reference_tables()

    genomic_df.to_csv(os.path.join(out_dir, "genomic_variants.csv"), index=False)
    clinical_df.to_csv(os.path.join(out_dir, "clinical_data.csv"), index=False)
    pda_df.to_csv(os.path.join(out_dir, "patient_drug_allergy.csv"), index=False)
    drug_gene_df.to_csv(os.path.join(out_dir, "drug_gene_metabolism.csv"), index=False)
    gene_allergy_df.to_csv(os.path.join(out_dir, "gene_allergy_association.csv"), index=False)

    print(f"[generate_all] wrote clinical_data.csv ({len(clinical_df)} patients, "
          f"adr_risk positive rate={clinical_df['adr_risk'].mean():.2f})")
    print(f"[generate_all] wrote genomic_variants.csv ({len(genomic_df)} rows, {len(GENE_PANEL)} markers)")
    print(f"[generate_all] wrote patient_drug_allergy.csv ({len(pda_df)} rows)")
    print(f"[generate_all] wrote drug_gene_metabolism.csv ({len(drug_gene_df)} rows)")
    print(f"[generate_all] wrote gene_allergy_association.csv ({len(gene_allergy_df)} rows)")
    print(f"[generate_all] drug catalog size: {len(DRUG_CATALOG)} (matches frontend)")
    return {
        "clinical": clinical_df, "genomic": genomic_df, "patient_drug_allergy": pda_df,
        "drug_gene": drug_gene_df, "gene_allergy": gene_allergy_df,
    }


if __name__ == "__main__":
    generate_all()
