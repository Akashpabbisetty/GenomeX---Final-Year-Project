# Requirements — Knowledge-graph drug→ADR association prediction (primary experiment)
## Introduction
Predict which adverse-effect terms a drug's label lists, using a pharmacological knowledge graph, evaluated so that results are not inflated by leakage.
## Requirements
1. **As a researcher, I want a reproducible graph build from the ingested data,** so that every experiment uses identical inputs.
   - WHEN `python research/kg/build_graph.py` runs THEN the system SHALL write node/edge tables (Parquet) with counts and SHA-256 recorded in provenance.
   - The graph SHALL contain drugs (SIDER), effect terms (MedDRA PT), genes (ClinPGx), drug–gene edges (guideline index + any ClinPGx export), and optional structure/TG-GATEs features.
2. **As a researcher, I want leakage-controlled splits.**
   - THE system SHALL provide a drug-wise cold-start split (held-out drugs have no label edges in training) and a term-wise split, with fixed seeds.
   - IF a random pair split is used THEN the report SHALL label it "optimistic" and not use it for claims.
3. **As a researcher, I want strong baselines.**
   - THE system SHALL implement: term-popularity prior; drug-similarity kNN (structure Tanimoto, gene-set Jaccard); logistic regression; matrix factorisation; and the GNN.
4. **As a researcher, I want ablations.**
   - THE system SHALL report +genes, +structure, +TG-GATEs features, and graph vs non-graph, each with 95% CIs (bootstrap over held-out drugs).
5. **As a reviewer, I want honest labels.**
   - THE report SHALL state that absent label entries are unlabeled (positive-unlabeled), and SHALL include calibration plots and per-term/per-drug-class error analysis.
6. **As a user, I want model output separated from rules.**
   - Model scores SHALL be exported as `data/model/assoc_scores.parquet` with model version/hash and SHALL never be used to set a rule category.
