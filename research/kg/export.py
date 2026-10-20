"""
research/kg/export.py
=================================================================
FEAT-004 -- Research-only export of drug->ADR association scores and the
model card.

Writes two things:
  1. data/model/assoc_scores.parquet -- the per-(drug, term) association
     scores with the model version + a content hash of the model. This file
     is RESEARCH OUTPUT ONLY. The deterministic engine MUST NEVER read it:
     it is produced here and consumed only by human analysis / later research
     steps. Nothing in engine/ or frontend/ loads this path.
  2. research/kg/MODEL_CARD.md -- the model card stating the positive-
     unlabeled (PU) caveat, the three dataset licences (ClinPGx CC BY-SA 4.0,
     SIDER, Open TG-GATEs), the rat-data limitation, and the intended-use
     statement: research only, never clinical, and it NEVER overrides or sets
     a rule category in the engine.

POSITIVE-UNLABELED (PU) CAVEAT -- a (drug, cui) pair present in SIDER is a
POSITIVE; an absent pair is UNLABELED, never a confirmed negative. Scores are
therefore an optimistic association signal, not calibrated true/false
probabilities.

Function-based module with `[kg.export] ...` print-logging. Fixed seed 42.

Run:
    research/kg/.venv/Scripts/python.exe research/kg/export.py
=================================================================
"""

import hashlib
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

SEED = 42

# Repository root = two levels up from this file (research/kg/export.py).
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.abspath(os.path.join(_THIS_DIR, "..", ".."))

DEFAULT_SCORES_OUT = "data/model/assoc_scores.parquet"
DEFAULT_MODEL_CARD = os.path.join(_THIS_DIR, "MODEL_CARD.md")
_ARTIFACTS_DIR = os.path.join(_THIS_DIR, "artifacts")


def _abspath(rel_or_abs):
    """Resolve a project-relative path against the repo root (absolute paths
    pass through unchanged)."""
    if os.path.isabs(rel_or_abs):
        return rel_or_abs
    return os.path.join(REPO_ROOT, rel_or_abs)


def model_hash(scores_df):
    """Content hash of the scored associations.

    SHA-256 over the (drug_id, cui, rounded-score) rows in a stable order so
    the same scores always yield the same hash. Used to version the export so
    a downstream consumer can tell which model run produced a parquet.
    """
    ordered = (scores_df[["drug_id", "cui", "score"]]
               .sort_values(["drug_id", "cui"])
               .reset_index(drop=True))
    h = hashlib.sha256()
    for drug_id, cui, score in ordered.itertuples(index=False):
        h.update(f"{drug_id}\t{cui}\t{float(score):.6f}\n".encode("utf-8"))
    digest = h.hexdigest()
    print(f"[kg.export.model_hash] hashed {len(ordered)} scored pairs -> "
          f"{digest[:12]}...")
    return digest


def export_scores(scores, model_version, graph_hash,
                  out=DEFAULT_SCORES_OUT):
    """Write research-only association scores to Parquet.

    `scores` is an iterable of (drug_id, cui, score) triples OR a DataFrame
    carrying at least drug_id/cui/score columns. `model_version` is a short
    string naming the model that produced the scores (e.g. the baseline name).
    `graph_hash` ties the export to the KG build it was scored on. The written
    columns are exactly: drug_id, cui, score, model_version, model_hash.

    RESEARCH ONLY -- the deterministic engine never reads this file.

    Returns (out_path, model_hash_hex).
    """
    if isinstance(scores, pd.DataFrame):
        df = scores[["drug_id", "cui", "score"]].copy()
    else:
        df = pd.DataFrame(list(scores), columns=["drug_id", "cui", "score"])
    df["drug_id"] = df["drug_id"].astype(str)
    df["cui"] = df["cui"].astype(str)
    df["score"] = df["score"].astype(float)

    mhash = model_hash(df)
    # Fold the model version into the hash column so the version and the exact
    # scored content are both recoverable from the file alone.
    full_hash = hashlib.sha256(
        f"{model_version}|{graph_hash}|{mhash}".encode("utf-8")).hexdigest()
    df["model_version"] = str(model_version)
    df["model_hash"] = full_hash

    out_abs = _abspath(out)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    df = df[["drug_id", "cui", "score", "model_version", "model_hash"]]
    df.to_parquet(out_abs, index=False)
    print(f"[kg.export.export_scores] wrote {len(df)} rows to {out} "
          f"(model_version={model_version!r} model_hash={full_hash[:12]}...)")
    print("[kg.export.export_scores] RESEARCH ONLY -- the deterministic "
          "engine must never read this file.")
    return out_abs, full_hash


def write_model_card(path=DEFAULT_MODEL_CARD, metrics=None, licences=None):
    """Write MODEL_CARD.md.

    The card states the PU caveat, the three dataset licences, the rat-data
    limitation of TG-GATEs, and the intended-use statement (research only,
    never clinical, never overrides or sets a rule category). `metrics` is an
    optional dict of headline numbers to report (e.g. AUROC with CI);
    `licences` is an optional dict overriding the default licence strings.

    Citations are deliberately left as [cite: verify] placeholders -- no
    citation is invented here.

    Returns the written path.
    """
    metrics = metrics or {}
    licences = licences or {}
    clinpgx = licences.get(
        "clinpgx",
        "ClinPGx (formerly PharmGKB) guideline annotations and gene table -- "
        "CC BY-SA 4.0: attribution required, indicate changes, ShareAlike "
        "(derived data must be shared under the same licence), and the data "
        "may not be sold (non-commercial). See the ClinPGx data usage policy.")
    sider = licences.get(
        "sider",
        "SIDER 4.1 (drug side effects extracted from drug labels, EMBL) -- "
        "licence not shipped with the files; to the best of our knowledge "
        "CC BY-NC-SA 4.0 (non-commercial, share-alike). TO BE VERIFIED at the "
        "SIDER source before any redistribution or commercial use.")
    tggates = licences.get(
        "tggates",
        "Open TG-GATEs (toxicogenomics) -- believed CC BY-SA (NBDC); not "
        "shipped with the upload. TO BE VERIFIED at the Open TG-GATEs source.")

    metrics_block = "\n".join(
        f"- {k}: {v}" for k, v in metrics.items()) or \
        "- Headline metrics are produced by `run_all.py` / `ablations.py` " \
        "(AUROC with 95% bootstrap CIs over held-out drugs). See " \
        "`artifacts/ablation_results.parquet`."

    generated_at = datetime.now(timezone.utc).isoformat()

    text = f"""# Model Card -- drug->ADR association prediction (research only)

Generated: {generated_at}

## Summary

This model predicts candidate associations between drugs and adverse drug
reaction (ADR) terms over a knowledge graph built from SIDER 4.1 side-effect
labels, ClinPGx guideline drug-gene annotations, the ClinPGx gene catalogue,
and Open TG-GATEs toxicogenomics scalars. It is a RESEARCH ARTEFACT. Its
output (`data/model/assoc_scores.parquet`) is shown separately as research
signal and is never consumed by the deterministic rule engine.

## Intended use and critical limitations on use

- **Research only.** This model supports research and exploratory analysis.
- **Not clinical.** It is NOT a medical device and produces NO clinical
  advice, diagnosis, dosing, or treatment recommendation.
- **Never overrides rules.** The model NEVER overrides, sets, or influences a
  rule category in the deterministic engine. There is no numeric safety score
  in the product; model predictions are a separate research output. The
  engine must never read `data/model/assoc_scores.parquet`.
- **No invented clinical facts.** No citations, clinical facts, or evidence
  are invented. Citation anchors in METHODS.md are `[cite: verify]`
  placeholders to be filled by a human.

## Positive-unlabeled (PU) caveat

The training labels are POSITIVE-UNLABELED. A (drug, cui) pair that appears in
SIDER is a POSITIVE label. A pair that is ABSENT is UNLABELED and is
not a confirmed negative. SIDER records what a drug label reports, not an
exhaustive true/false matrix. Consequently:

- Negatives used in training are SAMPLED from the unlabeled set as PU
  pseudo-negatives (not confirmed non-associations).
- Reported AUROC/AUPRC treat the unlabeled background as pseudo-negative and
  are therefore OPTIMISTIC UPPER BOUNDS, not calibrated true/false rates.
- A high score means "looks like known positives", not "confirmed adverse
  reaction".

## Data sources and licences

- {clinpgx}
- {sider}
- {tggates}

Attribution strings and SHA-256 digests of every input are recorded in
`research/kg/artifacts/provenance.json`.

## Known limitations

- **SIDER is a mid-2010s snapshot** derived from drug labels, not patient
  outcomes, and carries no severity grading.
- **Labels come from drug labels, not patient cohorts.** There is no patient
  cohort, no exposure/outcome timing, and no confounder adjustment.
- **TG-GATEs is preclinical RAT data at high doses** (plus an in-vitro array
  inventory), not human outcomes -- a species- and dose-mismatch limitation.
  Only 127 of the drugs have any TG-GATEs features; the rest carry a
  missing-mask.
- **Structure fingerprints are absent** in this environment (no
  `data_raw/pubchem/`), so structural similarity falls back to learned
  embeddings / gene-set similarity.
- **Cold-start evaluation only** is honest here: drug-wise held-out splits.
  The optimistic random-pair split is reported only as an upper bound.

## Metrics

{metrics_block}

## Provenance

- KG build + hashes: `research/kg/artifacts/provenance.json`
- Methods and evaluation design: `research/kg/METHODS.md`
- Run instructions: `research/kg/PROCESS.md`
"""

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    print(f"[kg.export.write_model_card] wrote {path}")
    return path


def _load_scored_pairs():
    """Produce a research-only score for every positive (drug, term) pair
    using the term-popularity baseline, so export.py can run end-to-end on the
    classical venv without torch. Returns (scores_df, model_version,
    graph_hash).

    This is intentionally the cheapest honest scorer; `run_all.py` passes in
    richer baseline scores. The export schema and caveats are identical either
    way.
    """
    import sys
    if _THIS_DIR not in sys.path:
        sys.path.insert(0, _THIS_DIR)
    import baselines as base  # noqa: E402

    nodes_drug = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "nodes_drug.parquet"))
    nodes_term = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "nodes_term.parquet"))
    edges_dt = pd.read_parquet(os.path.join(_ARTIFACTS_DIR, "edges_drug_term.parquet"))

    n_terms = int(nodes_term["term_index"].max()) + 1
    pairs = edges_dt[["drug_index", "term_index"]].to_numpy()
    model = base.term_popularity_prior(pairs, n_terms)
    raw_scores = base.predict_scores(model, pairs)

    drug_id_by_index = dict(zip(nodes_drug["drug_index"], nodes_drug["drug_id"]))
    cui_by_index = dict(zip(nodes_term["term_index"], nodes_term["cui"]))
    scores_df = pd.DataFrame({
        "drug_id": [drug_id_by_index[int(d)] for d, _ in pairs],
        "cui": [cui_by_index[int(t)] for _, t in pairs],
        "score": np.asarray(raw_scores, dtype=float),
    })

    graph_hash = _graph_hash()
    return scores_df, "term_popularity_v1", graph_hash


def _graph_hash():
    """Short hash tying the export to the KG build -- the provenance file's
    own content hash when present, else 'unknown'."""
    prov = os.path.join(_ARTIFACTS_DIR, "provenance.json")
    if not os.path.exists(prov):
        return "unknown"
    h = hashlib.sha256()
    with open(prov, "rb") as fh:
        h.update(fh.read())
    return h.hexdigest()[:16]


def main():
    """Export scores + write the model card end-to-end on the classical venv.

    Reads the FEAT-001 artifacts, scores every positive pair with the
    term-popularity baseline, writes data/model/assoc_scores.parquet, and
    writes the model card. `run_all.py` calls export_scores/write_model_card
    directly with richer inputs; this __main__ path keeps export.py runnable
    on its own.
    """
    print(f"[kg.export] start export seed={SEED} repo_root={REPO_ROOT}")
    scores_df, model_version, graph_hash = _load_scored_pairs()
    out_path, mhash = export_scores(scores_df, model_version, graph_hash)
    write_model_card(metrics={
        "note": "Export used the term-popularity baseline as a runnable "
                "default; see ablation_results.parquet for the full matrix.",
        "export_rows": len(scores_df),
        "model_hash": mhash,
    })
    print(f"[kg.export] OK -- wrote {out_path} and {DEFAULT_MODEL_CARD}")


if __name__ == "__main__":
    main()
