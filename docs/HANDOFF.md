# GenomX Advisor — handoff, plan and paper roadmap

## 1. State of play (honest)
| Area | State | Evidence |
|---|---|---|
| Rule engine (JS, deterministic) | **Working**, 32 hand-encoded rules (27 verified, 5 citation-pending), 49-case reference set agrees | `npm test` = 160 pass |
| Guideline layer | 217 ClinPGx annotations (CPIC 78, DPWG 110, …), 208 drugs; pointers only (not turned into actions) | `data/guidelines/` |
| Label side-effect layer | SIDER 4.1: 1,344 drugs, 140,677 drug–effect pairs, 4,251 terms (frequency for 41%) | `data/adverse/` |
| Preclinical layer | Open TG-GATEs rat blood chemistry: 127 compounds mapped (122 with in-vivo stats), 16 with ALT/AST signal; 3,000 stats re-verified vs raw | `data/tggates/`, `scripts/verify_tggates.py` |
| Web UI | Working (jsdom-tested; **never viewed in a real browser**) | `frontend/` |
| ML models (RF/XGB/CNN/BiLSTM/AE/fusion/GNN) | Code exists in `research/`, trained only on **synthetic** data; **not connected** to the app and **not valid evidence** | `research/` |
| Patient-level ADR prediction with genomics | **Not possible with data in hand** (no cohort with genotype + outcome) | see §3 |
| Gene expression (CEL) | **Unusable** (no CDF/probeset annotation); Ensembl dumps are schema-only | `docs/AUDIT.md` |
| Drug–drug interactions | **Not configured** (no verified dataset) | `data/interactions.json` |
| Research paper | Not started; methodology draft exists (needs updating to v2 — see §2) | — |

Catalog: 1418 drugs; 211 evaluated by default (have a rule or guideline); 208 with guidelines; 1344 with label data.

## 2. Your methodology document vs. what actually exists — fix before writing the paper
* §6.2 describes a **0–100 weighted safety score**. It was **removed** (weights were invented; a score could dilute a contraindication). The engine now uses seven categories with a documented precedence. Rewrite §6 accordingly — this is a strength: say why.
* §6.3 "48 interaction pairs across 16 drugs": that table was hand-written and unsourced → quarantined in `data/unverified/`. Do **not** cite it.
* §5 lists nine algorithms; only some are justified by the data (see §3). Report fewer, evaluated properly.
* §9 papers and links came from another assistant (`utm_source=chatgpt.com`): **I have not verified any of the 7 papers, their claims or URLs.** Open each, confirm it exists and says what you cite.
* §4 datasets: the data you actually hold are ClinPGx (guidelines+genes), SIDER, TG-GATEs. eICU and FAERS are **not** in hand.

## 3. The key decision: what is the predictive task?
A defensible ML contribution needs labelled data. Options, honestly assessed:
| Task | Data needed | Status |
|---|---|---|
| **A. Drug→ADR association prediction on a knowledge graph** (recommended primary) | SIDER labels (have), ClinPGx drug–gene edges (partly have), drug structure (PubChem via SIDER CIDs — to download), optional TG-GATEs features, optional drug–drug data | **Feasible now.** Real labels, 1,344 drugs × 4,251 effects |
| B. Rule-engine fidelity vs CPIC (independent reference) | CPIC phenotype→recommendation tables (CPIC API / ClinPGx download) | Feasible; gives true sensitivity/specificity of the engine |
| C. Does the rat ALT/AST signal predict human DILI concern? | FDA **DILIrank** (human DILI-concern labels; to download) + TG-GATEs (have) | Feasible; early look suggests low sensitivity (acetaminophen not flagged) — that is a *finding* |
| D. Patient-level ADR prediction from genotype + clinical data | A cohort with genotypes **and** outcomes (e.g. biobank/EHR-linked PGx cohort — needs access/approval) | **Not feasible without access.** Present as future work; use a clearly-labelled synthetic cohort only to demonstrate the system |
| E. FAERS signal detection | FAERS quarterly files (large; public) | Feasible as external validation of A (disproportionality; reporting bias caveats) |

**Recommendation:** primary = A (with cold-start, drug-wise splits, strong non-graph baselines, ablations incl. +gene edges, +TG-GATEs, +structure); secondary = B and C as component validations; D as a documented limitation + demo; E as external validation of A.

## 4. Data checklist (what to obtain, in order)
1. **PubChem structures** for SIDER CIDs (SMILES) — needed for A.
2. **ClinPGx full relationship/clinical-annotation exports** (gene–drug, variant–drug) — more KG edges.
3. **CPIC recommendation tables** (CPIC API or ClinPGx) — B.
4. **FDA DILIrank** — C. (verify licence/terms)
5. **FAERS** quarterly ASCII files (+ a drug-name normalisation table) — E. Use Parquet/DuckDB; expect many millions of reports.
6. **Interaction data** (candidates to evaluate and licence-check: DDInter, TWOSIDES/OffSIDES, DrugBank — DrugBank has restrictive licensing) — for the interaction module.
7. **eICU-CRD** (PhysioNet credentialing + DUA) — only if you can define a *valid* outcome label (exposure ≠ ADR).
8. A **real PGx cohort** if any collaborator/institution can provide one — unlocks task D.
Store raw files in `data_raw/` (git-ignored); every dataset gets a line in `data/sources.json` (hash, licence) via an ingest script.

## 5. Phased plan (≈14 weeks) with exit criteria
| Phase | Weeks | Deliverable | Exit criterion |
|---|---|---|---|
| 0 Setup | 0.5 | Kiro project, CI (`npm test`, pytest), `data_raw/` | tests green on fresh clone |
| 1 Data | 1–2 | PubChem, ClinPGx exports, CPIC tables, DILIrank ingested with provenance | `validate-data` passes; counts in `sources.json` |
| 2 KG + baselines (task A) | 3–5 | Graph build; popularity / kNN-similarity / logistic / matrix-factorisation baselines; cold-start splits | reproducible metrics table (AUROC, AUPRC, P@k) |
| 3 GNN + ablations | 6–8 | GNN (one clear task), ablations (+genes, +structure, +TG-GATEs), calibration | GNN vs best baseline with CIs; ablation table |
| 4 Component validations | 8–9 | B (engine vs CPIC), C (TG-GATEs vs DILIrank) | sensitivity/specificity + confusion matrices |
| 5 Rule coverage | 6–11 (parallel) | Encode more guidelines from phenotype tables; interactions; hepatic/pregnancy only with sources | each rule cites a source; reference cases added |
| 6 Integration | 9–12 | API + UI panel "model-based drug–ADR association (research)" kept separate from rules; synthetic-cohort demo; end-to-end test | patient JSON → results (rules + guidelines + label + model) works; model never alters category |
| 7 Paper | 8–14 (parallel) | Draft → internal review → submission | see §6 |

## 6. Research paper plan
**Working title (adjust to what you actually prove):** *GenomX Advisor: a provenance-first framework combining pharmacogenomic guideline rules, label-derived adverse-effect knowledge and graph learning for medication-safety screening.*
**Claims you can honestly make** (if experiments support them): (1) an open, tested, provenance-tracked engine that refuses to treat missing data as normal and keeps rules, guidelines and learned scores separate; (2) KG-based drug–ADR association prediction with cold-start evaluation and ablations; (3) quantified limits of preclinical (rat) liver signals against human DILI labels; (4) fidelity of the engine to CPIC.
**Do not claim:** clinical validity; patient-level ADR prediction; superiority without baselines/CIs; "first to combine…".
**Sections:** Introduction & gap (re-derive from the verified literature matrix) → Related work → Data & provenance (licences!) → Methods (engine, KG, models, splits, leakage controls) → Experiments (A, B, C, E, ablations) → Results (tables, calibration, error analysis) → Explainability (what is and isn't causal) → Limitations (labels from drug labels; PU-learning negatives; rat data; no patient cohort) → Ethics/safety statement → Reproducibility (code, hashes, seeds, environment).
**Figures/tables:** architecture; data-flow with licences; metrics table with CIs; ablation bars; calibration plot; ROC/PR; DILIrank confusion matrix; engine-vs-CPIC matrix; example explanation.
**Reporting standards:** follow TRIPOD+AI-style reporting where applicable; state what is not a clinical prediction model.
**Venues to consider (check scope/fit yourself):** Journal of Biomedical Informatics, BMC Bioinformatics, Frontiers in Pharmacology / Big Data, IEEE JBHI; workshop options at AMIA/ISMB-type venues.
**Literature matrix:** for each paper record problem, data, split, metrics, numbers, limits, relevance — verify every citation exists.

## 7. Risks
Label leakage (random pair splits); PU-learning negatives; SIDER age (2015 snapshot); licence limits (SIDER NC, ClinPGx SA, TG-GATEs SA) → **non-commercial & share-alike**; GPU needs for GNN on large graphs (PyTorch Geometric; CPU is fine for SIDER scale); scope creep (resist re-adding all nine algorithms).

## 8. Artifact inventory (what to carry into Kiro)
| Artifact | Keep? | Notes |
|---|---|---|
| `genomx_v2_2_kiro.zip` (this project) | **YES — the only code base to continue** | supersedes genomx_fixed.zip, genomx_v2.zip, genomx_v2_1.zip |
| Raw data you uploaded (5 files batch 1; TG-GATEs zips, Ensembl gz, CEL zip batch 2) | YES, in `data_raw/` | not shipped in the zip; re-run `scripts/ingest/*.py` |
| `GenomX methodology` document | Revise per §2 | becomes the paper's methods draft |
| Old `app.js`/`clinical_rules.py`/`README.md` (your uploads) | Archive only | superseded by v2 engine |
| `research/` (old Python ML stack) | Reuse selectively | synthetic-data only; rebuild on real labels in spec kg-adr-prediction |
| `docs/` (AUDIT, DATA_QUALITY, ENGINE, SECURITY, metrics.json, TEST_RESULTS) | YES | cite in paper's appendix |
