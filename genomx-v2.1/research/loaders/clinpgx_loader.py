"""
loaders/clinpgx_loader.py  (PharmGKB was renamed/merged into ClinPGx on
July 30, 2025 -- your pharmgkb.org/downloads link now redirects to
clinpgx.org/downloads. The underlying files are the same content,
some columns were just renamed, e.g. pharmgkbid -> clinpgxid,
"clinical annotations" -> "summary annotations".)
=================================================================
Ingests a ClinPGx/PharmGKB clinical (summary) annotations export and
turns it into the drug_gene_metabolism.csv / gene_allergy_association.csv
reference tables knowledge_graph.py expects -- replacing the small
hand-curated DRUG_GENE_METABOLISM / GENE_ALLERGY_ASSOCIATION dicts in
data_synthetic.py with real, curated CPIC/PharmGKB-sourced associations
covering far more genes and drugs than the 7 pairs used there.

I could not download the real export myself (network sandbox blocks
clinpgx.org; the file also requires accepting ClinPGx's data usage
terms on their site). Expected columns, verified via public
documentation/FAQ pages (not an actual file), are handled flexibly
below:

    Gene, Variant/Haplotypes, Drug(s) [or "Chemical"], Phenotype(s),
    Level of Evidence [or "Level of Evidence" / clinpgxlevel]

    RUN inspect_clinpgx_file() FIRST and compare its printed header
    against CANDIDATES below; tell me the real header if anything
    doesn't match and I'll adjust the mapping.
=================================================================
"""

import pandas as pd


def inspect_clinpgx_file(path: str, sep: str = "\t"):
    """Run this first on whatever file you downloaded (clinical_annotations.tsv /
    summary_annotations.tsv or similar) to confirm the real column names."""
    df = pd.read_csv(path, sep=sep, nrows=5)
    print(f"columns: {list(df.columns)}")
    print(df.head(3).to_string())
    return df


def _find_col(df: pd.DataFrame, candidates: list):
    lower_map = {c.lower(): c for c in df.columns}
    for cand in candidates:
        if cand.lower() in lower_map:
            return lower_map[cand.lower()]
    return None


GENE_CANDIDATES = ["Gene", "Genes", "gene"]
DRUG_CANDIDATES = ["Drug(s)", "Drugs", "Chemical", "Chemicals", "drug"]
PHENOTYPE_CANDIDATES = ["Phenotype(s)", "Phenotypes", "phenotype"]
EVIDENCE_CANDIDATES = ["Level of Evidence", "LevelOfEvidence", "clinpgxlevel", "pgkbcalevel", "level_of_evidence"]
VARIANT_CANDIDATES = ["Variant/Haplotypes", "Variant", "Haplotype", "Variants"]


def load_annotations(path: str, sep: str = "\t", min_evidence_level: str = None) -> pd.DataFrame:
    """min_evidence_level: e.g. '1A' to keep only the highest-confidence
    CPIC/guideline-backed associations, or None to keep everything."""
    df = pd.read_csv(path, sep=sep)
    cols = {
        "gene": _find_col(df, GENE_CANDIDATES),
        "drug": _find_col(df, DRUG_CANDIDATES),
        "phenotype": _find_col(df, PHENOTYPE_CANDIDATES),
        "evidence": _find_col(df, EVIDENCE_CANDIDATES),
        "variant": _find_col(df, VARIANT_CANDIDATES),
    }
    missing = [k for k, v in cols.items() if v is None and k in ("gene", "drug")]
    if missing:
        raise ValueError(
            f"annotations file missing required columns {missing}; "
            f"run inspect_clinpgx_file() and report the real header so I can fix the mapping."
        )
    rename = {v: k for k, v in cols.items() if v}
    out = df.rename(columns=rename)
    for opt in ("phenotype", "evidence", "variant"):
        if opt not in out.columns:
            out[opt] = None

    if min_evidence_level and "evidence" in out.columns:
        out = out[out["evidence"].astype(str).str.contains(min_evidence_level, na=False)]

    out = out.dropna(subset=["gene", "drug"])
    print(f"[clinpgx_loader.load_annotations] {len(out)} gene-drug annotation rows"
          + (f" (filtered to evidence containing '{min_evidence_level}')" if min_evidence_level else ""))
    return out[["gene", "drug", "phenotype", "evidence", "variant"]]


def build_drug_gene_metabolism(annotations: pd.DataFrame, out_path: str = None) -> pd.DataFrame:
    """Explodes multi-drug cells (ClinPGx sometimes lists several drugs
    per row, semicolon- or comma-separated) into one row per (drug, gene)
    pair, matching data_synthetic.py's drug_gene_metabolism.csv schema."""
    rows = []
    for _, r in annotations.iterrows():
        drugs = [d.strip() for d in str(r["drug"]).replace(";", ",").split(",") if d.strip()]
        for d in drugs:
            rows.append({"drugname": d, "gene": r["gene"]})
    out = pd.DataFrame(rows).drop_duplicates()
    if out_path:
        out.to_csv(out_path, index=False)
        print(f"[clinpgx_loader.build_drug_gene_metabolism] wrote {len(out)} rows to {out_path}")
    return out


def build_gene_allergy_association(annotations: pd.DataFrame, out_path: str = None) -> pd.DataFrame:
    """Maps gene -> phenotype/ADR association text, matching
    data_synthetic.py's gene_allergy_association.csv schema. ClinPGx's
    'Phenotype(s)' field is free text (e.g. 'Stevens-Johnson Syndrome',
    'Myopathy'), used here directly as the allergyname/ADR label."""
    sub = annotations.dropna(subset=["phenotype"])
    out = sub[["gene", "phenotype"]].rename(columns={"phenotype": "allergyname"}).drop_duplicates()
    if out_path:
        out.to_csv(out_path, index=False)
        print(f"[clinpgx_loader.build_gene_allergy_association] wrote {len(out)} rows to {out_path}")
    return out


if __name__ == "__main__":
    import sys
    path = sys.argv[1] if len(sys.argv) > 1 else "data/clinpgx_raw/clinical_annotations.tsv"
    inspect_clinpgx_file(path)
