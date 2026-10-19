# Design
- Code in `research/kg/` (new). Inputs: `data/adverse/drug/*.json`, `data/guidelines/index.json`, `data/tggates/index.json`, PubChem SMILES (to be downloaded into `data_raw/pubchem/`).
- Graph: PyG `HeteroData` (drug, term, gene). Edges: drug–term (label), drug–gene (guideline), optional drug–drug similarity (kNN). Node features: structure fingerprints (RDKit, if installable) or learned embeddings; TG-GATEs fold-changes for 122 drugs (with a missing-mask).
- Models: baselines in scikit-learn; GNN = heterogeneous message passing + dot-product decoder, BCE with sampled negatives (document the sampling), early stopping on a drug-wise validation split.
- Evaluation: AUROC, AUPRC, precision@k per drug, calibration (ECE, reliability), bootstrap CIs; ablation matrix; 5 seeds.
- Frequency (partial labels) is a secondary regression/ordinal task; do not mix it into the primary claim.
- Reproducibility: one command regenerates tables/figures into `paper/figures/`.
