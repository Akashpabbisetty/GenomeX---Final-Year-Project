"""
loaders/cel_parser.py
=================================================================
A real, from-scratch parser for Affymetrix "Calvin" format CEL files
(the binary format produced by GeneChip Command Console / AGCC, as
used by Open TG-GATEs' HG-U133_Plus_2 human arrays).

Validated against the 6 real CEL files uploaded for this project via
multiple independent cross-checks, all of which passed:
  - Parsed 'affymetrix-array-type' header parameter reads exactly
    "HG-U133_Plus_2", matching the array design named independently
    in Open-tggates_AllAttribute.tsv for these same sample barcodes.
  - Parsed 'affymetrix-fusion-experiment-name' matches the filename.
  - Intensity DataSet row count is exactly 1,164 x 1,164 = 1,354,896,
    the known true probe-cell geometry of the HG-U133_Plus_2 array.
  - The byte offset where header parsing stops exactly matches the
    file header's declared data-group start position.
  - Sub-table shapes are all internally consistent (StdDev has the
    same row count as Intensity; Outlier/Mask/GlobalGrid tables have
    small, plausible row counts).

Limitation (please read): this parser extracts raw per-cell probe
intensities, indexed by (X, Y) position on the array -- NOT gene- or
probeset-level expression values. Turning raw intensities into
"CYP3A4 was upregulated 2-fold" style statements requires the
Affymetrix HG-U133_Plus_2 CDF (probe-to-probeset mapping file) plus a
real normalization pipeline (e.g. RMA), neither of which is
included here or fabricated -- see README for how to get real gene-
level values (short version: run R/Bioconductor `affy`/`oligo`, or
Affymetrix Power Tools, on your own machine, and hand me the
resulting expression matrix).
=================================================================
"""

import struct
import numpy as np


def _read_narrow_string(data: bytes, pos: int):
    (n,) = struct.unpack_from(">i", data, pos)
    pos += 4
    s = data[pos:pos + n]
    pos += n
    return s.decode("ascii", errors="replace"), pos


def _read_wide_string(data: bytes, pos: int):
    (n,) = struct.unpack_from(">i", data, pos)
    pos += 4
    s = data[pos:pos + n * 2]
    pos += n * 2
    return s.decode("utf-16-be", errors="replace").rstrip("\x00"), pos


def _parse_generic_header(data: bytes, pos: int, depth: int = 0):
    data_type_id, pos = _read_narrow_string(data, pos)
    unique_file_id, pos = _read_narrow_string(data, pos)
    date_time, pos = _read_wide_string(data, pos)
    locale, pos = _read_wide_string(data, pos)
    (n_params,) = struct.unpack_from(">i", data, pos); pos += 4
    params = {}
    for _ in range(n_params):
        name, pos = _read_wide_string(data, pos)
        (vlen,) = struct.unpack_from(">i", data, pos); pos += 4
        raw = data[pos:pos + vlen]; pos += vlen
        vtype, pos = _read_wide_string(data, pos)
        params[name] = _decode_param(raw, vtype)
    (n_parents,) = struct.unpack_from(">i", data, pos); pos += 4
    parents = []
    for _ in range(n_parents):
        parent, pos = _parse_generic_header(data, pos, depth + 1)
        parents.append(parent)
    return {"data_type_id": data_type_id, "unique_file_id": unique_file_id,
            "date_time": date_time, "locale": locale, "params": params, "parents": parents}, pos


def _decode_param(raw: bytes, vtype: str):
    t = vtype.lower()
    try:
        if "unsigned-integer-8" in t:
            return struct.unpack(">B", raw[:1])[0] if len(raw) >= 1 else None
        if "integer-8" in t or t.endswith("byte"):
            return struct.unpack(">b", raw[:1])[0] if len(raw) >= 1 else None
        if "unsigned-integer-16" in t:
            return struct.unpack(">H", raw[:2])[0] if len(raw) >= 2 else None
        if "integer-16" in t:
            return struct.unpack(">h", raw[:2])[0] if len(raw) >= 2 else None
        if "unsigned-integer-32" in t:
            return struct.unpack(">I", raw[:4])[0] if len(raw) >= 4 else None
        if "integer-32" in t:
            return struct.unpack(">i", raw[:4])[0] if len(raw) >= 4 else None
        if "float" in t:
            return struct.unpack(">f", raw[:4])[0] if len(raw) >= 4 else None
        if "text/ascii" in t or "text/plain" in t:
            if len(raw) % 2 == 0:
                return raw.decode("utf-16-be", errors="ignore").rstrip("\x00")
            return raw.decode("ascii", errors="ignore").rstrip("\x00")
    except struct.error:
        pass
    return raw  # fall back to raw bytes if type is unrecognized


_VALUE_TYPE_FMT = {0: "b", 1: "B", 2: "h", 3: "H", 4: "i", 5: "I", 6: "f"}


def _parse_data_set(data: bytes, pos: int):
    (first_element_pos,) = struct.unpack_from(">I", data, pos); pos += 4
    (next_set_pos,) = struct.unpack_from(">I", data, pos); pos += 4
    name, pos = _read_wide_string(data, pos)
    (n_params,) = struct.unpack_from(">i", data, pos); pos += 4
    for _ in range(n_params):
        _, pos = _read_wide_string(data, pos)
        (vlen,) = struct.unpack_from(">i", data, pos); pos += 4 + vlen
        _, pos = _read_wide_string(data, pos)
    (n_cols,) = struct.unpack_from(">i", data, pos); pos += 4
    columns = []
    for _ in range(n_cols):
        col_name, pos = _read_wide_string(data, pos)
        (value_type,) = struct.unpack_from(">b", data, pos); pos += 1
        (size,) = struct.unpack_from(">i", data, pos); pos += 4
        columns.append((col_name, value_type, size))
    (n_rows,) = struct.unpack_from(">I", data, pos); pos += 4
    return {"name": name, "n_rows": n_rows, "columns": columns,
            "first_element_pos": first_element_pos, "next_set_pos": next_set_pos}


def _parse_data_group(data: bytes, pos: int):
    (next_group_pos,) = struct.unpack_from(">I", data, pos); pos += 4
    (first_dataset_pos,) = struct.unpack_from(">I", data, pos); pos += 4
    (n_datasets,) = struct.unpack_from(">i", data, pos); pos += 4
    name, pos = _read_wide_string(data, pos)
    datasets = []
    dpos = first_dataset_pos
    for _ in range(n_datasets):
        ds = _parse_data_set(data, dpos)
        datasets.append(ds)
        dpos = ds["next_set_pos"]
    return {"name": name, "datasets": datasets, "next_group_pos": next_group_pos}


def _read_column(data: bytes, ds: dict, col_index: int) -> np.ndarray:
    col_name, value_type, size = ds["columns"][col_index]
    fmt_char = _VALUE_TYPE_FMT[value_type]
    row_fmt = ">" + "".join(_VALUE_TYPE_FMT[vt] for _, vt, _ in ds["columns"])
    row_size = struct.calcsize(row_fmt)
    n = ds["n_rows"]
    dtype = {"b": np.int8, "B": np.uint8, "h": np.int16, "H": np.uint16,
             "i": np.int32, "I": np.uint32, "f": np.float32}[fmt_char]
    values = np.empty(n, dtype=dtype)
    offset_in_row = struct.calcsize(">" + "".join(_VALUE_TYPE_FMT[vt] for _, vt, _ in ds["columns"][:col_index]))
    base = ds["first_element_pos"]
    single_fmt = ">" + fmt_char
    for i in range(n):
        values[i] = struct.unpack_from(single_fmt, data, base + i * row_size + offset_in_row)[0]
    return values


def parse_cel(path: str, validate: bool = True) -> dict:
    """Parses one .CEL file. Returns a dict with array_type, rows, cols,
    per-cell intensity/stddev/pixel arrays (indexed 0..rows*cols-1 in the
    file's native row-major order), and the raw header metadata."""
    with open(path, "rb") as f:
        data = f.read()

    magic, version = struct.unpack_from(">bb", data, 0)
    if magic != 59 or version != 1:
        raise ValueError(f"{path}: not a recognized Calvin CEL file (magic={magic}, version={version})")

    (data_group_pos,) = struct.unpack_from(">I", data, 6)
    header, header_end_pos = _parse_generic_header(data, 10)

    if validate and header_end_pos != data_group_pos:
        raise ValueError(
            f"{path}: header parsing ended at byte {header_end_pos} but file header declares the "
            f"data group starts at {data_group_pos} -- parser is likely out of sync with this file's "
            f"exact layout; refusing to report intensities that may be misaligned."
        )

    group = _parse_data_group(data, data_group_pos)
    ds_by_name = {ds["name"]: ds for ds in group["datasets"]}

    intensity_ds = ds_by_name["Intensity"]
    intensities = _read_column(data, intensity_ds, 0)

    array_type = header["params"].get("affymetrix-array-type", "").strip()
    rows = header["params"].get("affymetrix-cel-rows")
    cols = header["params"].get("affymetrix-cel-cols")

    if validate and rows and cols and rows * cols != intensity_ds["n_rows"]:
        raise ValueError(
            f"{path}: header says {rows}x{cols}={rows*cols} cells but Intensity DataSet has "
            f"{intensity_ds['n_rows']} rows -- inconsistent, refusing to report results."
        )

    return {
        "path": path, "array_type": array_type, "rows": rows, "cols": cols,
        "n_cells": intensity_ds["n_rows"], "intensities": intensities,
        "scan_date": header["parents"][0]["params"].get("affymetrix-scan-date") if header["parents"] else None,
        "experiment_name": header["parents"][0]["params"].get("affymetrix-fusion-experiment-name") if header["parents"] else None,
    }


if __name__ == "__main__":
    import sys
    result = parse_cel(sys.argv[1] if len(sys.argv) > 1 else "003016092020.CEL")
    print(f"array_type={result['array_type']} rows={result['rows']} cols={result['cols']} "
          f"n_cells={result['n_cells']} experiment_name={result['experiment_name']} scan_date={result['scan_date']}")
    print(f"intensity range: min={result['intensities'].min():.1f} max={result['intensities'].max():.1f} "
          f"mean={result['intensities'].mean():.1f} median={np.median(result['intensities']):.1f}")
