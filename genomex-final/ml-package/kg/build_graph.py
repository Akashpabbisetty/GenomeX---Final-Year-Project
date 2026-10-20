"""
research/kg/build_graph.py
=================================================================
FEAT-001 -- Graph-build foundation for the drug->ADR association
knowledge graph (research-only; NEVER feeds the deterministic engine).

Reproducibly builds the KG node/edge tables from the local data snapshot
(SIDER 4.1 side effects, ClinPGx guideline drug-gene annotations, the
ClinPGx gene catalogue, and the Open TG-GATEs toxicogenomics scalars) and
writes them to Parquet under research/kg/artifacts/ together with a
provenance.json carrying SHA-256 digests of every input and output.

Label semantics (PU-learning): a (drug, cui) pair present in SIDER is a
POSITIVE; absence is UNLABELED, never a confirmed negative. freq/lo/hi are
a secondary ordinal target and MUST NOT enter the primary binary claim.

Optional structure fingerprints (RDKit, data_raw/pubchem/) are a lazy,
optional path; both are absent in this environment, so the build falls
back to learned embeddings and records the fallback flag.

Function-based module with `[kg.build] ...` print-logging per step, mirroring
research/models/random_forest_model.py. Fixed seed 42.

Run:
    research/kg/.venv/Scripts/python.exe research/kg/build_graph.py
=================================================================
"""

import hashlib
import json
import os
import sys
import platform
from datetime import datetime, timezone

import numpy as np
import pandas as pd

SEED = 42

# Repository root = two levels up from this file (research/kg/build_graph.py).
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))

# TG-GATEs scalar feature columns (index scalars; see plan.md). Each gets a
# companion *_mask boolean recording whether the value was present (non-null).
TGGATES_FEATURE_COLS = [
    "max_alt_fold",
    "max_ast_fold",
    "in_vitro_human",
    "in_vitro_rat",
    "animals",
    "liver_enzyme_signal",
    "n_flagged_groups",
]


# --------------------------------------------------------------------------- #
# Path helpers
# --------------------------------------------------------------------------- #
def _abspath(rel_or_abs: str) -> str:
    """Resolve a project-relative path against the repo root (absolute paths
    pass through unchanged)."""
    if os.path.isabs(rel_or_abs):
        return rel_or_abs
    return os.path.join(REPO_ROOT, rel_or_abs)


# --------------------------------------------------------------------------- #
# Loaders
# --------------------------------------------------------------------------- #
def load_sider(drug_dir="data/adverse/drug",
               index_path="data/adverse/index.json",
               terms_path="data/adverse/terms.json"):
    """Load SIDER per-drug positives + the index + the term vocabulary.

    Returns (drug_records, term_labels, index_meta, consumed_paths) where
    drug_records maps drug_id -> {"cids": [...], "effects": [(cui, freq_str,
    lo, hi, rank), ...]} (positives only) and term_labels maps cui -> label.
    The per-drug files are the CANONICAL source for label edges.
    """
    index_abs = _abspath(index_path)
    terms_abs = _abspath(terms_path)
    drug_dir_abs = _abspath(drug_dir)

    with open(index_abs, "r", encoding="utf-8") as fh:
        index_meta = json.load(fh)
    with open(terms_abs, "r", encoding="utf-8") as fh:
        term_labels = json.load(fh)

    drug_ids = sorted(index_meta["drugs"].keys())
    consumed = [index_abs, terms_abs]
    drug_records = {}
    total_effects = 0
    for drug_id in drug_ids:
        path = os.path.join(drug_dir_abs, f"{drug_id}.json")
        with open(path, "r", encoding="utf-8") as fh:
            rec = json.load(fh)
        consumed.append(path)
        effects = []
        for row in rec.get("effects", []):
            # Row order per `cols`: [cui, freq_str, lo, hi, placeboHi, rank].
            cui = row[0]
            freq_str = row[1]
            lo = row[2]
            hi = row[3]
            rank = row[5] if len(row) > 5 else None
            effects.append((cui, freq_str, lo, hi, rank))
        total_effects += len(effects)
        drug_records[drug_id] = {"cids": rec.get("cids", []), "effects": effects}

    print(f"[kg.load_sider] loaded {len(drug_records)} drugs, "
          f"{len(term_labels)} terms, {total_effects} positive (drug,cui) pairs "
          f"from {drug_dir}")
    return drug_records, term_labels, index_meta, consumed


def load_guideline_edges(index_path="data/guidelines/index.json"):
    """Load ClinPGx guideline drug-gene edges as a list of
    (drug_id, gene_symbol, source, guideline_id) tuples by cross-producting
    each guideline's drugs[].drugId with its genes[].

    Returns (edges, attribution, consumed_paths).
    """
    index_abs = _abspath(index_path)
    with open(index_abs, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    attribution = data.get("attribution", "")
    edges = []
    for g in data.get("guidelines", []):
        gid = g.get("id")
        source = g.get("source")
        genes = g.get("genes", []) or []
        for d in g.get("drugs", []) or []:
            drug_id = d.get("drugId")
            if drug_id is None:
                continue
            for sym in genes:
                edges.append((drug_id, sym, source, gid))
    print(f"[kg.load_guideline_edges] {len(edges)} drug-gene edges from "
          f"{len(data.get('guidelines', []))} guidelines")
    return edges, attribution, [index_abs]


def load_gene_catalog(path="data/gene_catalog.json"):
    """Load the ClinPGx gene catalogue keyed by `symbol`.

    Returns (gene_meta, attribution, consumed_paths) where gene_meta maps
    symbol -> {name, is_vip, has_cpic}.
    """
    path_abs = _abspath(path)
    with open(path_abs, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    attribution = data.get("attribution", "")
    gene_meta = {}
    for g in data.get("genes", []):
        gene_meta[g["symbol"]] = {
            "name": g.get("name", ""),
            "is_vip": bool(g.get("isVip", False)),
            "has_cpic": bool(g.get("hasCpicGuideline", False)),
        }
    print(f"[kg.load_gene_catalog] {len(gene_meta)} gene symbols")
    return gene_meta, attribution, [path_abs]


def load_tggates(index_path="data/tggates/index.json"):
    """Load Open TG-GATEs scalar features per drug id (the index scalars).

    Returns (features, attribution, consumed_paths) where features maps
    drug_id -> {col: value_or_None} using the canonical TGGATES_FEATURE_COLS
    names. Missing values stay None so a per-column mask can be built later.
    """
    index_abs = _abspath(index_path)
    with open(index_abs, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    attribution = data.get("attribution", "")
    compounds = data.get("compounds", {})
    features = {}
    for drug_id, rec in compounds.items():
        features[drug_id] = {
            "max_alt_fold": rec.get("maxALTfold"),
            "max_ast_fold": rec.get("maxASTfold"),
            "in_vitro_human": rec.get("inVitroHuman"),
            "in_vitro_rat": rec.get("inVitroRat"),
            "animals": rec.get("animals"),
            # liverEnzymeSignal is a bool in source -> 0/1 scalar.
            "liver_enzyme_signal": (None if rec.get("liverEnzymeSignal") is None
                                    else int(bool(rec.get("liverEnzymeSignal")))),
            "n_flagged_groups": rec.get("nFlaggedGroups"),
        }
    print(f"[kg.load_tggates] {len(features)} TG-GATEs compounds")
    return features, attribution, [index_abs]


def load_structure_fingerprints(cids_by_drug, raw_dir="data_raw/pubchem", n_bits=2048):
    """Optional RDKit Morgan fingerprints keyed by drug id.

    Lazy-imports RDKit and reads SMILES from `raw_dir` keyed by PubChem CID.
    When `raw_dir` is absent or RDKit is not installed, returns (None, True)
    so downstream code falls back to learned embeddings. In this environment
    both are absent, so the fallback path is the expected one.

    Returns (fingerprints_or_None, used_fallback: bool).
    """
    raw_abs = _abspath(raw_dir)
    if not os.path.isdir(raw_abs):
        print(f"[kg.load_structure_fingerprints] {raw_dir} absent -> "
              f"falling back to learned embeddings (used_fallback=True)")
        return None, True
    try:
        from rdkit import Chem  # noqa: F401  (lazy, optional)
        from rdkit.Chem import AllChem  # noqa: F401
    except ImportError:
        print("[kg.load_structure_fingerprints] RDKit not installed -> "
              "falling back to learned embeddings (used_fallback=True)")
        return None, True

    # RDKit present and directory exists: compute fingerprints. (Not exercised
    # in this environment; kept minimal and documented as an extension point.)
    from rdkit import Chem
    from rdkit.Chem import AllChem
    fingerprints = {}
    for drug_id, cids in cids_by_drug.items():
        for cid in cids:
            smiles_path = os.path.join(raw_abs, f"{cid}.smi")
            if not os.path.exists(smiles_path):
                continue
            with open(smiles_path, "r", encoding="utf-8") as fh:
                smiles = fh.read().strip().split()[0]
            mol = Chem.MolFromSmiles(smiles)
            if mol is None:
                continue
            fp = AllChem.GetMorganFingerprintAsBitVect(mol, 2, nBits=n_bits)
            fingerprints[drug_id] = np.frombuffer(fp.ToBitString().encode(), dtype="S1")
            break
    print(f"[kg.load_structure_fingerprints] computed {len(fingerprints)} "
          f"fingerprints from {raw_dir} (used_fallback=False)")
    return fingerprints, False


# --------------------------------------------------------------------------- #
# Table builders
# --------------------------------------------------------------------------- #
def build_node_tables(drug_records, term_labels, guideline_edges, gene_meta,
                      tggates_features, drugs_meta):
    """Build the three node tables with contiguous integer indices.

    The drug node set is the UNION of SIDER / guideline / TG-GATEs ids, keyed
    on the exact id string (no invented mapping). Per-node source flags
    (in_sider/in_guideline/in_tggates) and n_positive_terms are recorded.

    Returns (nodes_drug_df, nodes_term_df, nodes_gene_df,
             drug_index, term_index, gene_index) where the *_index dicts map
    id -> contiguous int.
    """
    sider_ids = set(drug_records.keys())
    guideline_drug_ids = {e[0] for e in guideline_edges}
    tggates_ids = set(tggates_features.keys())
    all_drug_ids = sorted(sider_ids | guideline_drug_ids | tggates_ids)

    drug_index = {d: i for i, d in enumerate(all_drug_ids)}
    drug_rows = []
    for d in all_drug_ids:
        meta = drugs_meta.get(d, {})
        n_pos = len(drug_records.get(d, {}).get("effects", []))
        drug_rows.append({
            "drug_id": d,
            "drug_index": drug_index[d],
            "name": meta.get("name", d),
            "drug_class": meta.get("class"),
            "in_sider": d in sider_ids,
            "in_guideline": d in guideline_drug_ids,
            "in_tggates": d in tggates_ids,
            "n_positive_terms": n_pos,
        })
    nodes_drug_df = pd.DataFrame(drug_rows)

    # Term nodes: full SIDER term vocabulary (cui -> label), with per-term
    # positive drug counts computed from the per-drug records.
    term_pos_count = {cui: 0 for cui in term_labels}
    for rec in drug_records.values():
        for (cui, _f, _lo, _hi, _r) in rec["effects"]:
            if cui in term_pos_count:
                term_pos_count[cui] += 1
            else:
                term_pos_count[cui] = 1  # term seen in effects but not in vocab
    all_cuis = sorted(term_labels.keys())
    term_index = {c: i for i, c in enumerate(all_cuis)}
    term_rows = [{
        "cui": c,
        "term_index": term_index[c],
        "label": term_labels[c],
        "n_drugs": term_pos_count.get(c, 0),
    } for c in all_cuis]
    nodes_term_df = pd.DataFrame(term_rows)

    # Gene nodes: the gene catalogue symbols (41).
    all_symbols = sorted(gene_meta.keys())
    gene_index = {s: i for i, s in enumerate(all_symbols)}
    gene_rows = [{
        "symbol": s,
        "gene_index": gene_index[s],
        "name": gene_meta[s]["name"],
        "is_vip": gene_meta[s]["is_vip"],
        "has_cpic": gene_meta[s]["has_cpic"],
    } for s in all_symbols]
    nodes_gene_df = pd.DataFrame(gene_rows)

    print(f"[kg.build_node_tables] drug nodes={len(nodes_drug_df)} "
          f"(sider={len(sider_ids)} guideline={len(guideline_drug_ids)} "
          f"tggates={len(tggates_ids)}) term nodes={len(nodes_term_df)} "
          f"gene nodes={len(nodes_gene_df)}")
    return (nodes_drug_df, nodes_term_df, nodes_gene_df,
            drug_index, term_index, gene_index)


def _parse_freq(freq_str):
    """Return the free-text frequency as str|None (kept verbatim)."""
    return freq_str


def build_edge_tables(drug_records, guideline_edges, drug_index, term_index,
                      gene_index, gene_meta):
    """Build the two primary edge tables.

    - edges_drug_term (positives only): drug_index, term_index, freq_str,
      freq_lo, freq_hi, rank.
    - edges_drug_gene (guideline): drug_index, gene_index, source, guideline_id.

    Returns (edges_drug_term_df, edges_drug_gene_df, unmatched).
    unmatched records ids that could not be joined (should be empty here).
    """
    dt_rows = []
    unmatched_terms = set()
    for drug_id, rec in drug_records.items():
        di = drug_index[drug_id]
        for (cui, freq_str, lo, hi, rank) in rec["effects"]:
            ti = term_index.get(cui)
            if ti is None:
                unmatched_terms.add(cui)
                continue
            dt_rows.append({
                "drug_index": di,
                "term_index": ti,
                "freq_str": _parse_freq(freq_str),
                "freq_lo": (None if lo is None else float(lo)),
                "freq_hi": (None if hi is None else float(hi)),
                "rank": (0.0 if rank is None else float(rank)),
            })
    edges_drug_term_df = pd.DataFrame(
        dt_rows,
        columns=["drug_index", "term_index", "freq_str", "freq_lo", "freq_hi", "rank"],
    )

    dg_rows = []
    unmatched_genes = set()
    for (drug_id, sym, source, gid) in guideline_edges:
        di = drug_index.get(drug_id)
        gi = gene_index.get(sym)
        if di is None:
            continue
        if gi is None:
            unmatched_genes.add(sym)
            continue
        dg_rows.append({
            "drug_index": di,
            "gene_index": gi,
            "source": source,
            "guideline_id": gid,
        })
    edges_drug_gene_df = pd.DataFrame(
        dg_rows,
        columns=["drug_index", "gene_index", "source", "guideline_id"],
    )

    print(f"[kg.build_edge_tables] drug-term edges={len(edges_drug_term_df)} "
          f"drug-gene edges={len(edges_drug_gene_df)} "
          f"unmatched_terms={len(unmatched_terms)} "
          f"unmatched_genes={len(unmatched_genes)}")
    unmatched = {
        "terms": sorted(unmatched_terms),
        "genes": sorted(unmatched_genes),
    }
    return edges_drug_term_df, edges_drug_gene_df, unmatched


def build_knn_edges(edges_drug_gene_df, nodes_drug_df, k=10, basis="gene_jaccard"):
    """Optional drug-drug kNN similarity edges.

    Default basis is gene_jaccard because structure fingerprints are absent
    here. Builds the Jaccard similarity between drugs over their guideline
    gene sets and keeps the top-k neighbours per drug (undirected, i<j).

    Returns edges_drug_drug_knn_df with columns
    drug_index_i, drug_index_j, weight, basis.
    """
    # Map each drug_index -> set of gene_index from guideline edges.
    gene_sets = {}
    for di, gi in zip(edges_drug_gene_df["drug_index"], edges_drug_gene_df["gene_index"]):
        gene_sets.setdefault(int(di), set()).add(int(gi))

    drug_ids = sorted(gene_sets.keys())
    rows = []
    for di in drug_ids:
        sims = []
        gi_set = gene_sets[di]
        for dj in drug_ids:
            if dj == di:
                continue
            gj_set = gene_sets[dj]
            inter = len(gi_set & gj_set)
            if inter == 0:
                continue
            union = len(gi_set | gj_set)
            sims.append((dj, inter / union))
        sims.sort(key=lambda t: (-t[1], t[0]))
        for dj, w in sims[:k]:
            a, b = (di, dj) if di < dj else (dj, di)
            rows.append((a, b, w))

    # De-duplicate undirected pairs (keep first occurrence / max weight).
    seen = {}
    for a, b, w in rows:
        key = (a, b)
        if key not in seen or w > seen[key]:
            seen[key] = w
    knn_rows = [{"drug_index_i": a, "drug_index_j": b, "weight": float(w), "basis": basis}
                for (a, b), w in sorted(seen.items())]
    edges_drug_drug_knn_df = pd.DataFrame(
        knn_rows,
        columns=["drug_index_i", "drug_index_j", "weight", "basis"],
    )
    print(f"[kg.build_knn_edges] {len(edges_drug_drug_knn_df)} drug-drug "
          f"kNN edges (k={k}, basis={basis})")
    return edges_drug_drug_knn_df


def build_tggates_features(tggates_features, drug_index):
    """Build the TG-GATEs scalar feature table with a per-column missing-mask.

    Only drugs present in TG-GATEs get a row. Each scalar column is paired
    with a boolean <col>_mask that is True when the value was present.

    Returns feat_drug_tggates_df.
    """
    rows = []
    for drug_id, feats in tggates_features.items():
        di = drug_index.get(drug_id)
        if di is None:
            continue
        row = {"drug_index": di}
        for col in TGGATES_FEATURE_COLS:
            val = feats.get(col)
            row[col] = (np.nan if val is None else float(val))
            row[f"{col}_mask"] = val is not None
        rows.append(row)
    columns = ["drug_index"]
    for col in TGGATES_FEATURE_COLS:
        columns.append(col)
        columns.append(f"{col}_mask")
    feat_drug_tggates_df = pd.DataFrame(rows, columns=columns).sort_values("drug_index")
    print(f"[kg.build_tggates_features] {len(feat_drug_tggates_df)} TG-GATEs "
          f"feature rows x {len(TGGATES_FEATURE_COLS)} scalars (+masks)")
    return feat_drug_tggates_df.reset_index(drop=True)


# --------------------------------------------------------------------------- #
# Provenance / IO
# --------------------------------------------------------------------------- #
def sha256_file(path):
    """Return the hex SHA-256 digest of a file read in binary chunks."""
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _library_versions():
    import sklearn
    import scipy
    import pyarrow
    return {
        "python": platform.python_version(),
        "numpy": np.__version__,
        "pandas": pd.__version__,
        "pyarrow": pyarrow.__version__,
        "scikit-learn": sklearn.__version__,
        "scipy": scipy.__version__,
    }


def write_artifacts(tables, inputs_consumed, attributions, used_fallback,
                    unmatched, out_dir="research/kg/artifacts", seed=SEED):
    """Write every node/edge/feature table to Parquet and emit provenance.json.

    `tables` maps table_name -> DataFrame. `inputs_consumed` is a list of
    absolute input paths. `attributions` is a dict of licence/attribution
    strings. Prints per-table counts.

    Returns the provenance dict.
    """
    out_abs = _abspath(out_dir)
    os.makedirs(out_abs, exist_ok=True)

    table_counts = {}
    output_hashes = {}
    for name, df in tables.items():
        path = os.path.join(out_abs, f"{name}.parquet")
        df.to_parquet(path, index=False)
        table_counts[name] = int(len(df))
        output_hashes[f"{name}.parquet"] = sha256_file(path)
        print(f"[kg.write_artifacts] wrote {name}.parquet rows={len(df)}")

    input_hashes = {}
    for path in sorted(set(inputs_consumed)):
        rel = os.path.relpath(path, REPO_ROOT).replace(os.sep, "/")
        input_hashes[rel] = sha256_file(path)

    provenance = {
        "schema": "kg-provenance/1",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": seed,
        "table_counts": table_counts,
        "input_sha256": input_hashes,
        "output_sha256": output_hashes,
        "attributions": attributions,
        "structure_fallback": bool(used_fallback),
        "unmatched_ids": unmatched,
        "library_versions": _library_versions(),
        "notes": {
            "label_semantics": "SIDER (drug,cui) presence is a POSITIVE; "
                               "absence is UNLABELED, not a negative (PU-learning).",
            "tggates_limitation": "TG-GATEs scalars are preclinical rat / in-vitro "
                                  "data at high doses, not human outcomes.",
            "tggates_count": "127 TG-GATEs compounds matched (not ~122).",
        },
    }
    prov_path = os.path.join(out_abs, "provenance.json")
    with open(prov_path, "w", encoding="utf-8") as fh:
        json.dump(provenance, fh, indent=2, sort_keys=True)
    print(f"[kg.write_artifacts] wrote provenance.json "
          f"({len(input_hashes)} inputs, {len(output_hashes)} outputs)")
    return provenance


def _load_drugs_meta(path="data/drugs.json"):
    """Load drug display name/class metadata keyed by id. Returns
    (drugs_meta, consumed_paths)."""
    path_abs = _abspath(path)
    with open(path_abs, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    drugs_meta = {d["id"]: {"name": d.get("name", d["id"]), "class": d.get("class")}
                  for d in data.get("drugs", [])}
    return drugs_meta, [path_abs]


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def main(seed=SEED):
    np.random.seed(seed)
    print(f"[kg.build] start build_graph seed={seed} repo_root={REPO_ROOT}")

    drug_records, term_labels, index_meta, c_sider = load_sider()
    guideline_edges, attr_guideline, c_guide = load_guideline_edges()
    gene_meta, attr_gene, c_gene = load_gene_catalog()
    tggates_features, attr_tggates, c_tg = load_tggates()
    drugs_meta, c_drugs = _load_drugs_meta()
    sources_consumed = [_abspath("data/sources.json")]
    with open(sources_consumed[0], "r", encoding="utf-8") as fh:
        sources_json = json.load(fh)

    cids_by_drug = {d: rec["cids"] for d, rec in drug_records.items()}
    _fingerprints, used_fallback = load_structure_fingerprints(cids_by_drug)

    (nodes_drug_df, nodes_term_df, nodes_gene_df,
     drug_index, term_index, gene_index) = build_node_tables(
        drug_records, term_labels, guideline_edges, gene_meta,
        tggates_features, drugs_meta)

    edges_drug_term_df, edges_drug_gene_df, unmatched = build_edge_tables(
        drug_records, guideline_edges, drug_index, term_index, gene_index, gene_meta)

    edges_drug_drug_knn_df = build_knn_edges(edges_drug_gene_df, nodes_drug_df)
    feat_drug_tggates_df = build_tggates_features(tggates_features, drug_index)

    # SIDER licence/attribution from data/sources.json.
    sider_licence = next((s.get("license", "") for s in sources_json.get("sources", [])
                          if s.get("id") == "sider"), "")
    attributions = {
        "clinpgx_guidelines": attr_guideline,
        "clinpgx_genes": attr_gene,
        "tggates": attr_tggates,
        "sider": sider_licence,
    }

    tables = {
        "nodes_drug": nodes_drug_df,
        "nodes_term": nodes_term_df,
        "nodes_gene": nodes_gene_df,
        "edges_drug_term": edges_drug_term_df,
        "edges_drug_gene": edges_drug_gene_df,
        "edges_drug_drug_knn": edges_drug_drug_knn_df,
        "feat_drug_tggates": feat_drug_tggates_df,
    }

    inputs_consumed = (c_sider + c_guide + c_gene + c_tg + c_drugs + sources_consumed)
    provenance = write_artifacts(
        tables, inputs_consumed, attributions, used_fallback, unmatched)

    # ---- Verification against SIDER index totals (hard asserts) ----
    expected_drugs_with_pos = len(index_meta["drugs"])
    n_drugs_with_pos = int((nodes_drug_df["n_positive_terms"] > 0).sum())
    expected_terms = int(index_meta["terms"])
    expected_pairs = int(index_meta["pairs"])

    print(f"[kg.build] COUNTS drugs_with_positives={n_drugs_with_pos} "
          f"(expected {expected_drugs_with_pos}) | "
          f"total_drug_nodes={len(nodes_drug_df)} | "
          f"term_nodes={len(nodes_term_df)} (expected {expected_terms}) | "
          f"gene_nodes={len(nodes_gene_df)} | "
          f"drug_term_edges={len(edges_drug_term_df)} (expected {expected_pairs}) | "
          f"drug_gene_edges={len(edges_drug_gene_df)}")

    problems = []
    if n_drugs_with_pos != expected_drugs_with_pos:
        problems.append(f"drugs_with_positives {n_drugs_with_pos} != "
                        f"{expected_drugs_with_pos}")
    if len(nodes_term_df) != expected_terms:
        problems.append(f"term_nodes {len(nodes_term_df)} != {expected_terms}")
    if len(edges_drug_term_df) != expected_pairs:
        problems.append(f"drug_term_edges {len(edges_drug_term_df)} != "
                        f"{expected_pairs}")
    if problems:
        print("[kg.build] COUNT MISMATCH: " + "; ".join(problems), file=sys.stderr)
        sys.exit(1)

    print("[kg.build] OK -- all count checks passed; artifacts written to "
          "research/kg/artifacts/")
    return provenance


if __name__ == "__main__":
    main()
