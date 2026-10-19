"""
loaders/eicu_loader.py
=================================================================
Ingests real eICU Collaborative Research Database v2.0 CSV exports
(patient.csv, allergy.csv, lab.csv, medication.csv, and optionally
pastHistory.csv / diagnosis.csv) and maps them into the clinical_data.csv
/ patient_drug_allergy.csv schema the rest of the GenomX pipeline expects
-- so once you have real eICU files, nothing downstream needs to change.

I could not download or open real eICU files myself (PhysioNet access
requires your own credentialed account + signed DUA, and my sandbox's
network is separately restricted to a small package-registry whitelist).
The column names below were verified against public eICU-CRD
documentation/schema references, not against an actual file, so:

    RUN inspect_eicu_directory() FIRST and compare its output against
    the column lists below. If anything doesn't match (e.g. a table
    version difference), tell me the actual header row and I'll adjust
    the *_CANDIDATES lists -- everything else in this file is written
    to already tolerate small naming differences.

Known real v2.0 columns used here (confirmed via public schema docs):
    allergy.csv     : patientunitstayid, drugname, allergyname, allergyoffset, allergyenteredoffset
    patient.csv     : patientunitstayid, gender, age, admissionheight, admissionweight,
                       dischargeweight, ethnicity, hospitalid, wardid, ...
    lab.csv         : patientunitstayid, labname, labresult, labresultoffset
    medication.csv  : patientunitstayid, drugname, dosage, routeadmin,
                       drugstartoffset, drugstopoffset, frequency
    pastHistory.csv : column names vary more across releases -- inspect before relying on it.
=================================================================
"""

import os
import glob
import numpy as np
import pandas as pd


def inspect_eicu_directory(path: str):
    """Run this first. Prints every CSV found and its column names /
    first couple of rows, so mismatches with the *_CANDIDATES lists
    below can be caught and reported back before running anything else."""
    files = sorted(glob.glob(os.path.join(path, "*.csv")) + glob.glob(os.path.join(path, "*.csv.gz")))
    if not files:
        print(f"[inspect_eicu_directory] no CSVs found under {path}")
        return
    for f in files:
        try:
            df = pd.read_csv(f, nrows=3)
            print(f"\n=== {os.path.basename(f)} ===")
            print(f"columns: {list(df.columns)}")
            print(df.head(2).to_string())
        except Exception as e:
            print(f"[inspect_eicu_directory] could not read {f}: {e}")


def _find_col(df: pd.DataFrame, candidates: list):
    lower_map = {c.lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in lower_map:
            return lower_map[cand.lower()]
    return None


def _load_csv(data_dir: str, filename_candidates: list) -> pd.DataFrame:
    for name in filename_candidates:
        for ext in ("", ".gz"):
            path = os.path.join(data_dir, name + ext)
            if os.path.exists(path):
                return pd.read_csv(path)
    raise FileNotFoundError(f"none of {filename_candidates} found under {data_dir}")


# ---- Table-specific loaders, each tolerant to minor naming drift -------
def load_allergy_table(data_dir: str) -> pd.DataFrame:
    df = _load_csv(data_dir, ["allergy.csv", "allergy"])
    cols = {
        "patientunitstayid": _find_col(df, ["patientunitstayid"]),
        "drugname": _find_col(df, ["drugname"]),
        "allergyname": _find_col(df, ["allergyname"]),
        "allergyoffset": _find_col(df, ["allergyoffset"]),
        "allergyenteredoffset": _find_col(df, ["allergyenteredoffset"]),
    }
    missing = [k for k, v in cols.items() if v is None and k in ("patientunitstayid", "drugname", "allergyname")]
    if missing:
        raise ValueError(f"allergy.csv missing required columns {missing}; run inspect_eicu_directory() and report the real header.")
    out = df.rename(columns={v: k for k, v in cols.items() if v})
    for opt in ("allergyoffset", "allergyenteredoffset"):
        if opt not in out.columns:
            out[opt] = 0
    return out[["patientunitstayid", "drugname", "allergyname", "allergyoffset", "allergyenteredoffset"]].dropna(
        subset=["patientunitstayid", "drugname", "allergyname"]
    )


def load_patient_table(data_dir: str) -> pd.DataFrame:
    df = _load_csv(data_dir, ["patient.csv", "patient"])
    cols = {
        "patientunitstayid": _find_col(df, ["patientunitstayid"]),
        "gender": _find_col(df, ["gender", "sex"]),
        "age": _find_col(df, ["age"]),
        "admissionheight": _find_col(df, ["admissionheight", "height"]),
        "admissionweight": _find_col(df, ["admissionweight", "weight"]),
    }
    missing = [k for k, v in cols.items() if v is None]
    if missing:
        raise ValueError(f"patient.csv missing columns {missing}; run inspect_eicu_directory() and report the real header.")
    out = df.rename(columns={v: k for k, v in cols.items()})
    # eICU top-codes age as the string "> 89"; treat as 90 for numeric use
    out["age"] = pd.to_numeric(out["age"].replace({"> 89": "90"}), errors="coerce")
    return out[["patientunitstayid", "gender", "age", "admissionheight", "admissionweight"]]


def load_lab_table(data_dir: str) -> pd.DataFrame:
    df = _load_csv(data_dir, ["lab.csv", "lab"])
    cols = {
        "patientunitstayid": _find_col(df, ["patientunitstayid"]),
        "labname": _find_col(df, ["labname"]),
        "labresult": _find_col(df, ["labresult"]),
    }
    missing = [k for k, v in cols.items() if v is None]
    if missing:
        raise ValueError(f"lab.csv missing columns {missing}; run inspect_eicu_directory() and report the real header.")
    return df.rename(columns={v: k for k, v in cols.items()})[["patientunitstayid", "labname", "labresult"]]


def load_medication_table(data_dir: str) -> pd.DataFrame:
    df = _load_csv(data_dir, ["medication.csv", "medication"])
    cols = {
        "patientunitstayid": _find_col(df, ["patientunitstayid"]),
        "drugname": _find_col(df, ["drugname"]),
    }
    missing = [k for k, v in cols.items() if v is None]
    if missing:
        raise ValueError(f"medication.csv missing columns {missing}; run inspect_eicu_directory() and report the real header.")
    return df.rename(columns={v: k for k, v in cols.items()})[["patientunitstayid", "drugname"]].dropna()


# ---- Aggregation into the GenomX clinical_data.csv schema --------------
LAB_NAME_MAP = {
    "creatinine": ["creatinine"],
    "alt": ["ALT", "ALT (SGPT)", "alt"],
    "egfr": ["EGFR", "egfr", "GFR"],
}
RENAL_IMPAIRED_CREATININE = 1.5   # mg/dL, commonly used simple cutoff
HEPATIC_IMPAIRED_ALT = 60          # U/L, roughly 2x ULN


def build_clinical_data(data_dir: str, out_path: str = None) -> pd.DataFrame:
    """Produces a dataframe matching data_synthetic.py's clinical_data.csv
    schema, built entirely from real eICU tables (no synthetic fill-in
    except for fields eICU genuinely doesn't have, e.g. pgx_risk_allele_count,
    which stays 0 until genomic data -- e.g. from 1000 Genomes/PharmVar -- is
    joined in separately)."""
    patient = load_patient_table(data_dir)
    lab = load_lab_table(data_dir)
    allergy = load_allergy_table(data_dir)
    medication = load_medication_table(data_dir)

    def lab_pivot(names, agg="median"):
        mask = lab["labname"].str.lower().isin([n.lower() for n in names])
        sub = lab[mask]
        return sub.groupby("patientunitstayid")["labresult"].agg(agg)

    creatinine = lab_pivot(LAB_NAME_MAP["creatinine"])
    alt = lab_pivot(LAB_NAME_MAP["alt"])
    egfr = lab_pivot(LAB_NAME_MAP["egfr"])

    allergy_agg = allergy.groupby("patientunitstayid")["allergyname"].apply(lambda s: ",".join(sorted(set(s))))
    meds_agg = medication.groupby("patientunitstayid")["drugname"].apply(lambda s: ",".join(sorted(set(s))))
    # weak ADR-risk label: did this patient have >=1 documented allergy tied to a drug?
    adr_risk = allergy.groupby("patientunitstayid")["drugname"].apply(lambda s: int(s.notna().any()))

    df = patient.set_index("patientunitstayid")
    df["creatinine"] = creatinine
    df["alt"] = alt
    df["egfr"] = egfr
    df["allergy_history"] = allergy_agg
    df["current_medications"] = meds_agg
    df["adr_risk"] = adr_risk.reindex(df.index).fillna(0).astype(int)

    df["kidney_function"] = np.where(df["creatinine"] > RENAL_IMPAIRED_CREATININE, "impaired", "normal")
    df["liver_function"] = np.where(df["alt"] > HEPATIC_IMPAIRED_ALT, "impaired", "normal")
    df["n_allergies"] = df["allergy_history"].fillna("").apply(lambda s: len([a for a in s.split(",") if a]))
    df["pgx_risk_allele_count"] = 0  # filled in once genomic data is joined

    df = df.reset_index().rename(columns={
        "patientunitstayid": "patient_id", "gender": "sex",
        "admissionheight": "height_cm", "admissionweight": "weight_kg",
    })
    final_cols = ["patient_id", "age", "sex", "weight_kg", "height_cm", "liver_function", "kidney_function",
                  "current_medications", "creatinine", "alt", "egfr", "allergy_history", "n_allergies",
                  "pgx_risk_allele_count", "adr_risk"]
    df = df[final_cols]

    if out_path:
        df.to_csv(out_path, index=False)
        print(f"[eicu_loader.build_clinical_data] wrote {len(df)} rows to {out_path}")
    return df


def build_patient_drug_allergy(data_dir: str, out_path: str = None) -> pd.DataFrame:
    """Direct passthrough of the allergy table -- already matches the
    patient_drug_allergy.csv schema used by knowledge_graph.py / gnn_model.py."""
    allergy = load_allergy_table(data_dir).rename(columns={"patientunitstayid": "patientunitstayid"})
    out = allergy.rename(columns={"patientunitstayid": "patientunitstayid"})
    out = out.rename(columns={"patientunitstayid": "patientunitstayid"})
    out.columns = ["patientunitstayid", "drugname", "allergyname", "allergyoffset", "allergyenteredoffset"]
    if out_path:
        out.to_csv(out_path, index=False)
        print(f"[eicu_loader.build_patient_drug_allergy] wrote {len(out)} rows to {out_path}")
    return out


if __name__ == "__main__":
    import sys
    directory = sys.argv[1] if len(sys.argv) > 1 else "data/eicu_raw"
    inspect_eicu_directory(directory)
