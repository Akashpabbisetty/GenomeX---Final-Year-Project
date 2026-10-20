# Model Card -- drug->ADR association prediction (research only)

Generated: 2026-10-20T04:56:22.033808+00:00

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

- ClinPGx (formerly PharmGKB) guideline annotations and gene table -- CC BY-SA 4.0: attribution required, indicate changes, ShareAlike (derived data must be shared under the same licence), and the data may not be sold (non-commercial). See the ClinPGx data usage policy.
- SIDER 4.1 (drug side effects extracted from drug labels, EMBL) -- licence not shipped with the files; to the best of our knowledge CC BY-NC-SA 4.0 (non-commercial, share-alike). TO BE VERIFIED at the SIDER source before any redistribution or commercial use.
- Open TG-GATEs (toxicogenomics) -- believed CC BY-SA (NBDC); not shipped with the upload. TO BE VERIFIED at the Open TG-GATEs source.

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

- AUROC (drug-wise cold-start, matrix factorisation): 0.8074 (95% CI 0.7888-0.8248; 269 held-out drugs; PU, optimistic)
- model_version: matrix_factorisation_v1
- model_hash: e6e6dd0c92704c458d43bdfacb1d2d141d1726d8523e8c36210f7ce1c797cc3d
- kg_graph_hash: 0a00d8241dada102

## Provenance

- KG build + hashes: `research/kg/artifacts/provenance.json`
- Methods and evaluation design: `research/kg/METHODS.md`
- Run instructions: `research/kg/PROCESS.md`
