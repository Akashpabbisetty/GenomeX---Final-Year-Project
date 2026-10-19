"""
loaders/tggates_loader.py
=================================================================
Joins parsed CEL intensity data (via cel_parser.py) with sample
metadata from Open-tggates_AllAttribute.tsv (compound, dose, tissue,
timepoint, species, plus the full clinical chemistry/hematology
panel for in vivo studies).

Confirmed from the real uploaded files: Open-tggates_AllAttribute.tsv
is Shift-JIS encoded (encoding='cp932'), not UTF-8 -- use that
encoding or pandas.read_csv will throw a UnicodeDecodeError partway
through the file.
=================================================================
"""

import numpy as np
import pandas as pd

from loaders.cel_parser import parse_cel

ATTRIBUTE_ENCODING = "cp932"  # Shift-JIS; confirmed against the real file


def load_attribute_table(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep="\t", encoding=ATTRIBUTE_ENCODING, low_memory=False)
    df["BARCODE"] = df["BARCODE"].astype(str)
    print(f"[tggates_loader.load_attribute_table] {len(df)} rows, {df['COMPOUND_NAME'].nunique()} unique compounds")
    return df


def build_sample_table(cel_paths: list, attribute_path: str) -> pd.DataFrame:
    """For each CEL file, parses it and joins in its experimental
    metadata by matching the barcode in the filename against the
    attribute table's BARCODE column."""
    attrs = load_attribute_table(attribute_path)
    rows = []
    intensities = {}
    for path in cel_paths:
        cel = parse_cel(path)
        barcode = cel["experiment_name"]
        meta = attrs[attrs["BARCODE"] == str(barcode)]
        if meta.empty:
            print(f"[tggates_loader] WARNING: no metadata row found for barcode {barcode} ({path}); skipping")
            continue
        meta_row = meta.iloc[0]
        log2_intensity = np.log2(cel["intensities"].astype(np.float64) + 1)
        rows.append({
            "barcode": barcode, "path": path, "array_type": cel["array_type"],
            "compound": meta_row.get("COMPOUND_NAME"), "dose": meta_row.get("DOSE"),
            "dose_unit": meta_row.get("DOSE_UNIT"), "dose_level": meta_row.get("DOSE_LEVEL"),
            "species": meta_row.get("SPECIES"), "test_type": meta_row.get("TEST_TYPE"),
            "organ": meta_row.get("ORGAN_ID"), "sacri_period": meta_row.get("SACRI_PERIOD"),
            "sex": meta_row.get("SEX_TYPE"), "alt_iu_l": meta_row.get("ALT(IU/L)"),
            "ast_iu_l": meta_row.get("AST(IU/L)"), "log2_mean_intensity": log2_intensity.mean(),
            "log2_median_intensity": np.median(log2_intensity),
        })
        intensities[barcode] = log2_intensity

    sample_df = pd.DataFrame(rows)
    print(f"[tggates_loader.build_sample_table] built {len(sample_df)} sample rows")
    return sample_df, intensities


def replicate_correlation_matrix(intensities: dict) -> pd.DataFrame:
    """Real QC check: Pearson correlation of raw log2 probe intensities
    across samples. NOTE: at raw-probe level (no RMA normalization / no
    CDF-based probeset summarization) these correlations are expected
    to be uniformly high (~0.98+) regardless of treatment -- that is
    NOT a sign of good or bad data, it's just what raw, unnormalized
    microarray data looks like. Real dose-response separation only
    becomes visible after proper preprocessing; don't over-interpret
    small differences in this matrix as biological signal."""
    labels = list(intensities.keys())
    mat = np.array([intensities[l] for l in labels])
    corr = np.corrcoef(mat)
    return pd.DataFrame(corr, index=labels, columns=labels)


if __name__ == "__main__":
    import glob
    cel_files = sorted(glob.glob("loaders/*.CEL"))
    sample_df, intensities = build_sample_table(cel_files, "/mnt/user-data/uploads/Open-tggates_AllAttribute.tsv")
    print(sample_df.to_string())
    print()
    print(replicate_correlation_matrix(intensities).round(4).to_string())
