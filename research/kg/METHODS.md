# METHODS -- drug->ADR association prediction over a knowledge graph

Research sub-project under `research/kg/`. This document describes the task,
the graph, the splits, the models, the metrics, and the honest limitations.
It is research only; the output never feeds the deterministic engine and never
sets or overrides a rule category. Citation anchors are `[cite: verify]`
placeholders -- no citation is invented here; a human fills them in.

## 1. Task definition

Given a drug and a candidate adverse drug reaction (ADR) term, predict a score
reflecting how strongly the drug is associated with that ADR, learned from
known drug->ADR associations plus pharmacogenomic and toxicogenomic side
information. This is framed as link prediction over a knowledge graph.

The labels are POSITIVE-UNLABELED (PU): a (drug, cui) pair present in SIDER is
a POSITIVE; an absent pair is UNLABELED, not a confirmed negative [cite: verify].
This framing drives every modelling and evaluation choice below.

## 2. Knowledge graph

Built by `build_graph.py` from the local data snapshot and written to Parquet
in `research/kg/artifacts/` with a `provenance.json` carrying SHA-256 digests
of every input and output.

Nodes:
- **drug** -- union of SIDER / ClinPGx-guideline / TG-GATEs drug ids, keyed on
  the exact id string (no invented id mapping). Source flags `in_sider`,
  `in_guideline`, `in_tggates` and a positive-term count are recorded.
- **term** -- SIDER MedDRA PT terms, keyed by UMLS CUI, with the human label.
- **gene** -- ClinPGx gene-catalogue symbols.

Edges / features:
- **drug--term** (label target, POSITIVES ONLY): a drug lists an ADR term in
  SIDER. The frequency fields (`freq_str`, `freq_lo`, `freq_hi`, `rank`) are a
  SECONDARY ordinal signal and are kept OUT of the primary binary claim.
- **drug--gene** (guideline): built by cross-producting each ClinPGx
  guideline's drugs with its genes [cite: verify].
- **drug--drug kNN** (optional similarity): gene-set Jaccard here (structure
  Tanimoto when fingerprints exist).
- **TG-GATEs scalar features** on drug nodes: `maxALTfold`, `maxASTfold`,
  in-vitro/in-vivo counts, flagged-group count, etc., each with a missing-mask
  (only a minority of drugs have TG-GATEs data).

## 3. Why cold-start (drug-wise) splits

The honest question is: does the model generalise to drugs it has never seen?
So the primary split is DRUG-WISE COLD-START (`splits.drug_wise_split`): a
held-out drug contributes NO label edge to training (`held_out_label_mask`
drops every training edge touching a held-out drug). This prevents the trivial
leakage where a drug's own associations teach the model about that same drug
[cite: verify].

Two secondary splits are provided and clearly labelled:
- **term-wise** cold-start over the ADR vocabulary.
- **random-pair** -- the OPTIMISTIC split; it leaks drugs across folds and is
  reported only as an upper-bound reference, never for headline claims.

All splits use a fixed seed (42) and are deterministic for that seed.

## 4. Models

Classical baselines (`baselines.py`; scikit-learn + numpy only, run on the
classical venv):
- **term-popularity prior** -- drug-agnostic term frequency.
- **drug-similarity kNN** -- similarity-weighted neighbour voting; gene-set
  Jaccard similarity now, structure Tanimoto when fingerprints exist.
- **logistic regression** -- on per-pair features (optionally augmented with
  TG-GATEs scalars).
- **matrix factorisation** -- numpy SGD latent factors, `sigmoid(D[d]·T[t])`.

GNN (`gnn.py`; OPTIONAL, torch / PyTorch Geometric lazy-imported): a
heterogeneous `HeteroData` graph with message passing and a dot-product
decoder, trained with binary cross-entropy over sampled negatives and early
stopping on the drug-wise validation split [cite: verify]. The module imports
cleanly without torch and raises a clear install message only when training is
invoked.

PU negatives: wherever a model needs negatives (logistic regression, matrix
factorisation, GNN), they are SAMPLED from the unlabeled set as PU
pseudo-negatives (uniform random non-positive pairs, `neg_ratio` per positive,
fixed seed). Absent pairs are NEVER treated as confirmed negatives.

## 5. Metrics and confidence intervals

Computed by `metrics.py` (scikit-learn + numpy only):
- **AUROC** and **AUPRC** (average precision; more informative under heavy
  class imbalance).
- **precision@k per drug**, averaged across drugs.
- **expected calibration error (ECE)** with a reliability table.
- **bootstrap confidence intervals** by RESAMPLING HELD-OUT DRUGS (groups),
  not individual pairs, so the interval reflects uncertainty in generalising
  to unseen drugs [cite: verify].

Because the unlabeled background is treated as pseudo-negative, AUROC/AUPRC
here are OPTIMISTIC UPPER BOUNDS, not calibrated true/false rates.

## 6. Ablation design

`ablations.py` runs a matrix over configurations (`popularity`, `knn`,
`logreg`, `mf`, `+genes`, `+structure`, `+tggates`, `graph`, `non-graph`) and
5 seeds, reporting AUROC with a 95% bootstrap CI over held-out drugs per
(config, seed). Dependency-gated cells are recorded as `skipped (dep absent)`
rather than failing: `graph` needs torch/PyG, `+structure` needs RDKit plus
the structure fingerprint artifact. Results are written to
`artifacts/ablation_results.parquet`.

## 7. Error analysis

`error_analysis.py` slices held-out performance by SIDER frequency band, by
drug class (null classes bucketed as `unknown`), and by label sparsity
(how many positive terms a drug carries). Each breakdown's per-group counts
reconcile to the total scored pairs.

## 8. Honest limitations

- **SIDER is a mid-2010s snapshot** derived from drug labels, not patient
  outcomes, with no severity grading and frequency available for only a
  minority of pairs [cite: verify].
- **Labels are from drug labels, not a patient cohort.** No exposure/outcome
  timing, no confounder adjustment, no causal claim.
- **TG-GATEs is preclinical RAT data at high doses** plus an in-vitro array
  inventory -- species and dose mismatch to human outcomes; only a minority
  of drugs are covered [cite: verify].
- **No structure data** in this environment (`data_raw/pubchem/` absent), so
  structural similarity falls back to learned embeddings / gene similarity.
- **PU labels** mean metrics are optimistic upper bounds, not calibrated
  probabilities.
- **Research only.** The output is never clinical and never overrides or sets
  a rule category in the deterministic engine.

## 9. Reproducibility

Fixed seed 42 throughout. `provenance.json` records SHA-256 digests of every
input and output, library versions, licence/attribution strings, and the
structure-fallback flag. See `PROCESS.md` for the exact run commands and
`MODEL_CARD.md` for intended use and licences.

## References

All references are to be supplied by a human reviewer; the following anchors
mark where citations belong and MUST be verified before publication:

- SIDER 4.1 side-effect resource -- [cite: verify]
- ClinPGx / PharmGKB guideline annotations -- [cite: verify]
- Open TG-GATEs toxicogenomics -- [cite: verify]
- Drug-wise cold-start evaluation for link prediction -- [cite: verify]
- Positive-unlabeled learning methodology -- [cite: verify]
- Heterogeneous graph neural networks for link prediction -- [cite: verify]
