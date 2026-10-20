# GenomX Advisor: A Provenance-First Framework Combining Pharmacogenomic Guideline Rules, Label-Derived Adverse-Effect Knowledge, and Graph Learning for Medication-Safety Screening

> **Draft status:** Structure, methods, and verified system outputs are complete.
> Items marked `[RESULT: fill after training]` require running `research/kg/run_all.py`
> on your ML machine and inserting the numbers.
> Items marked `[CITE: verify]` require you to open the paper and confirm it exists
> and says what you claim — do NOT submit without doing this.

---

## Abstract

We present GenomX Advisor, an open, evidence-traceable pharmacogenomic medication-safety screening system that combines three distinct knowledge layers: a deterministic rule engine encoding 60 CPIC/DPWG-sourced pharmacogenomic guidelines, a label-derived drug–adverse-drug-reaction (ADR) knowledge graph supporting association prediction, and a preclinical toxicogenomic signal from Open TG-GATEs. Unlike prior approaches that produce a single numeric safety score, GenomX Advisor applies a categorical, precedence-based decision structure in which model predictions are explicitly separated from guideline-based recommendations and never permitted to override them. We validate the rule engine against CPIC phenotype recommendations, report drug–ADR association prediction results from a knowledge-graph GNN with leakage-controlled drug-wise cold-start splits, and quantify the limits of preclinical rat liver signals as predictors of human drug-induced liver injury (DILI). The system is fully reproducible, carries explicit data provenance and licence attribution, and is designed for research and education — not for clinical deployment.

**Keywords:** pharmacogenomics, medication safety, knowledge graph, graph neural network, adverse drug reactions, CPIC, SIDER, decision support

---

## 1. Introduction

Adverse drug reactions (ADRs) remain a major clinical burden, with pharmacogenomic (PGx) variants explaining a significant proportion of inter-individual variation in drug response [CITE: verify — general PGx burden reference]. Clinical Pharmacogenomics Implementation Consortium (CPIC) and Dutch Pharmacogenetics Working Group (DPWG) guidelines encode phenotype-specific dosing and prescribing recommendations for a growing set of gene–drug pairs [CITE: verify — CPIC overview], yet these are unevenly implemented in electronic health record decision-support systems.

Existing PGx decision-support tools face several limitations: (1) many assign opaque numeric safety scores whose weights are unverifiable; (2) model outputs are often not separated from deterministic rule outputs, allowing a learned score to dilute an absolute contraindication; (3) data provenance and licences are inconsistently disclosed; (4) evaluation splits commonly leak information about held-out drugs, inflating apparent performance.

GenomX Advisor addresses these limitations through a deliberate design: rules, guidelines, label-derived learned associations, and preclinical data are kept as separate, clearly labelled layers. The deterministic layer uses an explicit seven-category hierarchy (avoid > modify > conditional > monitor > needs_info > informational > no_flag) with documented precedence. The learned layer is evaluated on drug-wise cold-start splits to assess generalisation to unseen drugs. Missing data is never treated as normal.

**Contributions:**
1. An open, tested, provenance-tracked pharmacogenomic rule engine with 60 hand-encoded cited guidelines and a 213-case automated test suite.
2. A knowledge-graph drug–ADR association prediction framework with reproducible leakage-controlled evaluation and an ablation study.
3. A quantified assessment of Open TG-GATEs preclinical rat liver signals as predictors of human DILI.
4. A complete software system serving as a research and education platform, with the deterministic and learned components explicitly separated.

---

## 2. Related Work

> **YOUR ACTION:** For each reference below, open the paper, confirm (a) it exists, (b) its title/year are correct, (c) it says what you claim. Remove any that do not exist. Add your own verified references.

- Relling & Evans (2015) — CPIC guidelines overview [CITE: verify — Nature Reviews Drug Discovery]
- Swen et al. (2011) — DPWG guidelines [CITE: verify]
- Kuhn et al. (2016) — SIDER 4.1 [CITE: verify — Nucleic Acids Research]
- Igarashi et al. (2015) — Open TG-GATEs [CITE: verify — Nucleic Acids Research]
- Himmelstein & Baranzini (2015) — Heterogeneous network drug repurposing [CITE: verify — PLOS Computational Biology]
- Schlichtkrull et al. (2018) — Relational Graph Convolutional Networks [CITE: verify — ESWC 2018]
- Kipf & Welling (2017) — Graph Convolutional Networks [CITE: verify — ICLR 2017]
- Bekker & Davis (2020) — Learning from positive and unlabeled data [CITE: verify — Machine Learning journal]
- Lu et al. (2022) — Drug-wise cold-start evaluation for link prediction [CITE: verify — find appropriate reference for leakage in drug-target/drug-side-effect prediction]

**Gap this paper fills:** To our knowledge, no prior system (a) enforces strict separation between guideline rules and learned associations with a formal precedence hierarchy, (b) evaluates drug–ADR prediction with drug-wise cold-start splits, and (c) reports on the reproducibility and limits of all three knowledge layers together.

---

## 3. Data and Provenance

### 3.1 Datasets

| Dataset | Version / Date | Content used | Records | Licence |
|---|---|---|---|---|
| SIDER 4.1 [CITE: verify] | 2015 snapshot | Drug–side-effect label pairs, MedDRA PT terms, frequency (partial) | 1,344 drugs, 4,251 MedDRA PT terms, 140,677 drug–ADR positive pairs (frequency available for ~41%) | CC BY-NC-SA 4.0 — non-commercial, verify before redistribution |
| ClinPGx (PharmGKB) [CITE: verify] | Downloaded 2024–2025 | Clinical guideline annotations (CPIC, DPWG, etc.), gene–drug associations | 217 guideline annotations, 208 drugs, 41 gene symbols | CC BY-SA 4.0 — attribute, share-alike, non-commercial |
| Open TG-GATEs [CITE: verify] | AllAttribute.tsv | Compound × dose × tissue × timepoint blood chemistry | 127 compounds mapped (122 with in-vivo stats), 16 with significant ALT/AST signal | CC BY-SA 4.0 — verify current terms |

### 3.2 Data not in hand (documented as limitations)

- eICU-CRD patient cohort — requires PhysioNet credentialing + DUA; loader implemented but not run
- PubChem SMILES structures for SIDER drug CIDs — not downloaded; structure features fall back to learned embeddings
- FDA DILIrank — needed for Task C validation; download and ingest before running DILI analysis
- FAERS — needed for external validation of Task A
- Real PGx patient cohort — not available; patient-level genotype→ADR prediction is future work

### 3.3 Reproducibility

Every pipeline run writes `research/kg/artifacts/provenance.json` recording SHA-256 digests of all input and output files, library versions, the structure-fallback flag, and licence/attribution strings. Fixed seed 42 throughout.

---

## 4. System Architecture

```
Patient input (age, sex, eGFR, genes, allergies, medications, conditions)
        │
        ▼
┌─────────────────────────────────────────────────────────┐
│          DETERMINISTIC RULE ENGINE (engine/)             │
│                                                          │
│  Layer 1: Hand-encoded PGx rules (60 rules, cited)  ─── avoid / modify
│  Layer 2: ClinPGx guideline pointers (217 annotations)─ informational
│  Layer 3: SIDER label side-effects (1,344 drugs)     ─  informational
│  Layer 4: TG-GATEs preclinical signal                ─  informational
│                                                          │
│  Category hierarchy: avoid > modify > conditional >      │
│                       monitor > needs_info > info >      │
│                       no_flag                            │
│  Missing data → needs_info (never no_flag)               │
└─────────────────────────────────────────────────────────┘
        │
        ▼ (separately, never overrides rules)
┌─────────────────────────────────────────────────────────┐
│   RESEARCH LAYER: KG drug–ADR association scores         │
│   (research/kg/ → data/model/assoc_scores.parquet)       │
│   Labelled "research output" in UI; never clinical       │
└─────────────────────────────────────────────────────────┘
```

### 4.1 Rule engine

The engine is implemented as pure ES modules (Node.js / browser). It applies rules in category-precedence order: the highest-severity applicable rule determines the final category for a drug. Rules are stored as versioned JSON in `data/rules/`; each rule cites at least one CPIC/DPWG annotation ID. A 213-case automated test suite validates every rule against a reference case citing its source.

### 4.2 Patient API

`POST /api/evaluate` accepts a patient JSON record, validates it server-side, runs the deterministic engine, and returns `{ findings, missingInformation, evidence, ruleSetVersion, disclaimer, dataAttributions }`. No numeric score appears in any response. An audit log stub records timestamp + patientId + ruleSetVersion (no PHI). Real patient data must not be used until a security and ethics review is complete.

### 4.3 Knowledge graph and ML layer

The research layer builds a heterogeneous knowledge graph from the three datasets above and trains drug–ADR association prediction models evaluated on drug-wise cold-start splits. Output is written to `data/model/assoc_scores.parquet` and is displayed in a separate "research output" panel in the UI, clearly labelled non-clinical and not permitted to alter any category.

---

## 5. Pharmacogenomic Rule Engine

### 5.1 Rule encoding methodology

Rules are encoded from CPIC and DPWG guideline phenotype tables. For each drug group:
1. The relevant ClinPGx annotation ID (G:PA*) is identified in `data/guidelines/index.json`
2. An evidence record is added to `data/evidence.json` citing the published guideline (PMCID)
3. The phenotype→recommendation mapping is read from the guideline and encoded as a rule JSON
4. A reference test case is added to `tests/fixtures/reference_cases.js` citing the source
5. `npm run validate-data` confirms schema integrity; `node --test` confirms the case passes

### 5.2 Rules encoded in this work

38 new rules were added across 9 drug groups (prior total: 22 rules):

| Drug group | Gene(s) | Phenotypes encoded | Rules | CPIC evidence |
|---|---|---|---|---|
| Tricyclic antidepressants (amitriptyline, nortriptyline, clomipramine, desipramine, imipramine) | CYP2D6, CYP2C19 | UM, IM, PM | 13 | CPIC 2016 update, PMC5478479 |
| SSRIs (citalopram, escitalopram, sertraline) | CYP2C19 | UM/rapid, IM, PM | 6 | CPIC 2023, PMC10564324 |
| Tacrolimus | CYP3A5 | Normal expresser, intermediate | 1 | CPIC 2015, PMC4481158 |
| Warfarin | CYP2C9, VKORC1, CYP4F2 | IM/PM, variant present | 3 | CPIC 2017, PMC5546947 |
| Tamoxifen | CYP2D6 | PM, IM | 2 | CPIC 2018, PMC5931215 |
| PPIs (omeprazole, lansoprazole) | CYP2C19 | UM/rapid | 2 | CPIC 2021, PMC7868475 |
| Voriconazole | CYP2C19 | UM/rapid, PM | 2 | CPIC 2017, PMC5474211 |
| Irinotecan | UGT1A1 | PM | 1 | DPWG annotation G:PA166104951 |
| G6PD drugs (dapsone, methylene blue, pegloticase, rasburicase, tafenoquine, toluidine blue, primaquine) | G6PD | Deficient, variable | 8 | CPIC 2023, PMC10281211 |
| **Total new** | | | **38** | |
| **Total (all rules)** | | | **60** | |

### 5.3 Test results

- Total automated test cases: **213**
- Passing: **213** (0 failing)
- `npm run validate-data`: **exit 0**, no schema errors
- Rule schema: every rule carries `status: "verified"`, `evidenceLevel: null`, no numeric fields

### 5.4 Known limitations in rule coverage

- CYP2C19 PM/IM rules for omeprazole and lansoprazole not encoded (guideline phenotype tables not fully available from index at encoding time)
- UGT1A1 intermediate metabolizer rule for irinotecan not encoded (guidance varies across guidelines)
- Clomipramine CYP2C19 UM: DPWG recommends avoidance for OCD/depression; encoded as `modify` because indication cannot be confirmed from current inputs

---

## 6. Knowledge-Graph Drug–ADR Association Prediction

### 6.1 Task definition

Given a drug and a candidate ADR term (MedDRA PT), predict a score for how strongly the drug is associated with that ADR. Labels are **positive-unlabeled (PU)**: a drug–term pair present in SIDER is a positive; an absent pair is *unlabeled*, not a confirmed negative.

### 6.2 Knowledge graph construction

Built by `research/kg/build_graph.py` from the data snapshot.

**Verified graph statistics:**

| Node/Edge type | Count |
|---|---|
| Drug nodes (SIDER ∪ ClinPGx ∪ TG-GATEs) | 1,418 |
| Drug nodes with SIDER positives | 1,344 |
| ADR term nodes (MedDRA PT) | 4,251 |
| Gene nodes (ClinPGx catalogue) | 41 |
| Drug–ADR label edges (positives) | 140,677 |
| Drug–gene edges (guidelines) | 481 |
| SHA-256 provenance recorded | Yes |

Drug node features: TG-GATEs scalar features (maxALTfold, maxASTfold, in-vitro/in-vivo counts) with per-column missing-mask (minority of drugs); structure fingerprints fall back to learned embeddings (PubChem SMILES not in this environment).

### 6.3 Evaluation splits

**Primary:** Drug-wise cold-start — held-out drugs contribute no label edges to training. This is the honest split testing generalisation to unseen drugs.
**Secondary — term-wise:** held-out ADR terms.
**Secondary — random pair (optimistic):** reported as upper bound only; must not be used for headline claims.

All splits: fixed seed 42, deterministic. Zero train/test drug overlap verified by automated unit test.

### 6.4 Models

**Classical baselines** (scikit-learn + numpy; no GPU):

| Model | Description |
|---|---|
| Term-popularity prior | Drug-agnostic term frequency; lower-bound reference |
| Drug-similarity kNN | Similarity-weighted neighbour voting (gene-set Jaccard) |
| Logistic regression | Per-pair feature model; optionally augmented with TG-GATEs scalars |
| Matrix factorisation | NumPy SGD latent factors, sigmoid dot-product decoder |

**GNN** (PyTorch Geometric; requires torch):
Heterogeneous message passing on the drug–term–gene graph, dot-product decoder, binary cross-entropy with sampled PU pseudo-negatives, early stopping on drug-wise validation split, 5 seeds.

Negative sampling for all models: uniform random sample from unlabeled pairs (absent not confirmed-negative); neg_ratio controlled; fixed seed.

### 6.5 Results — baselines (verified on this machine, no torch)

The classical pipeline was verified to run end-to-end on this machine. Baseline metrics on the drug-wise cold-start split (seed 42):

| Model | AUROC | AUPRC | P@10 (mean/drug) | Notes |
|---|---|---|---|---|
| Term-popularity prior | `[RESULT: fill after training]` | `[RESULT: fill after training]` | `[RESULT: fill after training]` | Lower bound |
| Drug-similarity kNN | `[RESULT: fill after training]` | `[RESULT: fill after training]` | `[RESULT: fill after training]` | Gene-set Jaccard |
| Logistic regression | `[RESULT: fill after training]` | `[RESULT: fill after training]` | `[RESULT: fill after training]` | |
| Matrix factorisation | `[RESULT: fill after training]` | `[RESULT: fill after training]` | `[RESULT: fill after training]` | |
| GNN | `[RESULT: fill after training]` | `[RESULT: fill after training]` | `[RESULT: fill after training]` | Requires torch |

> **YOUR ACTION:** Run `python run_all.py` on your ML machine. Open `artifacts/ablation_results.parquet` and `data/model/assoc_scores.parquet`. Copy the AUROC/AUPRC/P@10 values into the table above.
> Report 95% bootstrap CIs (over held-out drugs) alongside each number.

All metrics are optimistic upper bounds under PU labeling (absent pairs treated as pseudo-negatives).

### 6.6 Ablation results

| Configuration | AUROC (95% CI) | Notes |
|---|---|---|
| Popularity (no features) | `[RESULT: fill after training]` | Baseline |
| +genes | `[RESULT: fill after training]` | Add drug–gene edges |
| +structure | `[RESULT: fill after training]` | Requires RDKit + PubChem |
| +TG-GATEs | `[RESULT: fill after training]` | Add preclinical scalar features |
| Graph (GNN) | `[RESULT: fill after training]` | Requires torch |
| Non-graph best | `[RESULT: fill after training]` | Best classical baseline |

> **YOUR ACTION:** Copy from `artifacts/ablation_results.parquet`. Note which cells were skipped due to missing deps and document why.

### 6.7 Error analysis

Performance breakdown by SIDER frequency band, drug class, and label sparsity is computed by `error_analysis.py` and written to `artifacts/error_analysis_*.parquet`.

> **YOUR ACTION:** Add a table or figure from those files here after training. Discuss which drug classes or term-frequency bands the model performs best/worst on.

### 6.8 Calibration

Expected calibration error (ECE) and reliability diagrams are computed by `metrics.py`.

> **YOUR ACTION:** Add ECE value and reliability diagram here after training.

---

## 7. Preclinical Liver Signal Analysis (Task C)

### 7.1 TG-GATEs data

Open TG-GATEs provides in-vivo rat blood chemistry (ALT, AST, and others) and in-vitro data for compounds at multiple doses and timepoints. 127 compounds were mapped to the drug catalog; 16 showed significant ALT or AST fold-change at the highest dose in the in-vivo setting.

### 7.2 Comparison with FDA DILIrank

> **YOUR ACTION:** Download FDA DILIrank (https://www.fda.gov/science-research/liver-toxicity-knowledge-base-ltkb) — confirm licence/terms. Ingest with `scripts/ingest/` (build an ingest script). Then run the comparison:
> - For each TG-GATEs compound mapped to DILIrank, record: TG-GATEs ALT/AST flag (positive/negative) vs DILIrank DILI-concern label (most/less/no concern)
> - Compute sensitivity, specificity, PPV, NPV
> - Explain misses (e.g. acetaminophen — if ALT not flagged by TG-GATEs but is a well-known DILI drug, explain why: dose/timepoint mismatch, species difference, etc.)

**Placeholder results table:**

| Criterion | Sensitivity | Specificity | PPV | NPV |
|---|---|---|---|---|
| ALT fold-change > 2× at max dose | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` |
| AST fold-change > 2× at max dose | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` | `[RESULT: fill after DILIrank comparison]` |

---

## 8. System Demonstration

### 8.1 Synthetic cohort

A synthetic cohort of patients (clearly labelled SYNTHETIC) was generated by `genomex-final/api/synthetic_demo.js` and evaluated through the rule engine. The demo exercises all six output categories.

### 8.2 Example findings

| Patient | Gene variant | Drug flagged | Category | Rule cited |
|---|---|---|---|---|
| Synthetic P001 | HLA-B*57:01 positive | Abacavir | **avoid** | CPIC HLA-B/abacavir, E-HLA-B-57-ABACAVIR |
| Synthetic P002 | CYP2D6 poor metabolizer | Codeine | **avoid** | CPIC CYP2D6/codeine PM, E-CPIC-CODEINE-2014 |
| Synthetic P003 | CYP2C19 poor metabolizer | Clopidogrel | **avoid** | CPIC CYP2C19/clopidogrel PM, E-CPIC-CLOPIDOGREL |
| Synthetic P004 | CYP2D6 ultrarapid metabolizer | Amitriptyline | **modify** | E-CPIC-TCA-2017 |
| Synthetic P005 | CYP2C19 poor metabolizer | Voriconazole | **modify** | E-CPIC-VORI-2017 (CPIC: alternative antifungal) |
| Synthetic P006 | G6PD deficient | Dapsone | **avoid** | E-CPIC-G6PD-2023 |

---

## 9. Limitations

1. **SIDER is a 2015 snapshot.** Labels come from drug product labels, not patient outcome records. No severity grading. Frequency available for only ~41% of pairs. Absent pairs are unlabeled, not confirmed negatives — metrics are optimistic upper bounds.
2. **No patient cohort.** Patient-level genotype→ADR prediction is not feasible with data in hand. All patient-level examples use clearly-labelled synthetic data.
3. **TG-GATEs is preclinical rat data at high doses.** Species differences and dose extrapolation limit translation to human outcomes. Only 127 compounds are covered. The CEL microarray data cannot be used without a CDF annotation file (not included).
4. **No structure features.** PubChem SMILES not downloaded; structure Tanimoto similarity falls back to gene-set Jaccard. Structure ablation results will be skipped unless PubChem files are obtained.
5. **Drug–drug interaction module not configured.** No verified/licensed interaction dataset is available. The UI correctly states "interaction screening not performed."
6. **Rule coverage gaps.** 194 drugs have a published guideline but no hand-encoded rule (only a guideline pointer). CYP2C19 PM/IM for PPIs and UGT1A1 IM for irinotecan were not encoded in this version.
7. **Real browser testing not performed.** The UI is jsdom-tested. Visual, mobile, and screen-reader testing is needed before any real use.
8. **No authentication or audit logging in production form.** The current auth/audit stubs require a full security and ethics review before real patient data is used.
9. **Literature citations unverified.** Several citations in the original methodology document originated from an AI assistant. Every citation must be opened and verified manually before submission.

---

## 10. Ethics and Safety Statement

GenomX Advisor is an **educational research prototype**. It is not a medical device. It has not been clinically validated. It must not be used to make or influence prescribing decisions for real patients. The system includes an explicit disclaimer in all API responses and in the UI. Missing data is never treated as normal (it produces `needs_info`, not `no_flag`). Model predictions are displayed separately from rule-based findings and are never permitted to set or override a rule category. All datasets are used under their declared licences (ClinPGx CC BY-SA 4.0, SIDER CC BY-NC-SA 4.0, TG-GATEs — verify current terms). Real patient data must not be processed until a formal security, privacy, and ethics review is complete.

---

## 11. Reproducibility

All pipeline steps are reproducible from the versioned data with fixed seed 42:
```bash
# Rebuild the knowledge graph and run all experiments
python research/kg/run_all.py

# Re-run JS engine tests and data validation
node --test "tests/*.test.js"
npm run validate-data
```
SHA-256 provenance is recorded at `research/kg/artifacts/provenance.json`. Library versions are pinned in `research/kg/requirements.txt`. All rule JSON files and reference cases are version-controlled.

---

## 12. Conclusion

> **YOUR ACTION:** Write this after you have real ML results. State:
> - What the system achieves (rule engine fidelity, KG prediction performance)
> - What the honest limits are (no patient cohort, SIDER snapshot, PU labels)
> - What this contributes vs prior work
> - What future work would look like (real patient cohort, more rules, interaction data)

---

## Appendix A — Technologies Used

| Component | Technology | Version |
|---|---|---|
| Rule engine | JavaScript (ES Modules) | Node.js 22 |
| Web UI | Vanilla JS, no framework | — |
| API server | Node.js http module | Node.js 22 |
| Test runner | Node.js built-in test runner | Node.js 22 |
| Data validation | Custom JSON schema validator | — |
| ML pipeline | Python | 3.13 |
| Data processing | pandas, pyarrow, duckdb | pandas 3.0.6, pyarrow 26.0.0, duckdb 1.5.6 |
| Classical ML | scikit-learn | 1.9.1 |
| Numerical | numpy, scipy | numpy 2.5.4 |
| Graph ML | PyTorch + PyTorch Geometric | torch 2.5.1, pyg 2.6.1 (install on ML machine) |
| Structure features | RDKit | (optional; install on ML machine) |
| Knowledge graph | Parquet (PyArrow) + custom Python builder | — |

---

## Appendix B — File Map for Paper Figures

After running `python research/kg/run_all.py` on your ML machine, figures are written to `research/kg/figures/`. Suggested figures for the paper:

1. **System architecture diagram** — the layered architecture (rules → guidelines → labels → model)
2. **Knowledge graph schema** — node types (drug, term, gene) and edge types
3. **Ablation bar chart** — AUROC by configuration with 95% CIs from `artifacts/ablation_results.parquet`
4. **Calibration / reliability diagram** — from `metrics.py`
5. **ROC/PR curves** — best model vs baselines
6. **DILIrank confusion matrix** — TG-GATEs ALT/AST vs human DILI concern (after Task C)
7. **Rule-engine vs CPIC agreement matrix** — after Task B

---

*Draft produced at end of initial Kiro build session.*
*All `[RESULT: fill after training]` placeholders require running `python research/kg/run_all.py` on an ML-capable machine.*
*All `[CITE: verify]` placeholders require manually opening each paper before submission.*
