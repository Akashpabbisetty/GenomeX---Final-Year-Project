# GenomX Research-Grade Multi-Model Pipeline

A real implementation of all 9 algorithms from the GenomX research-grade
architecture document: a multi-modal fusion network (tabular + genomic
sequence + latent features) feeding a knowledge-graph GNN, with an
explainability layer on top.

```
Clinical data ─┬─> Random Forest (Alg 1) ─┐
               └─> XGBoost (Alg 2) ────────┤
Genomic seqs ──┬─> CNN (Alg 3) ────────────┤─> Fusion Network (Alg 6)
               └─> Bi-LSTM (Alg 4) ────────┤        │
Clinical+genomic─> Autoencoder (Alg 5) ────┘        ▼
                                     Knowledge Graph (Alg 7)
                                                     │  patient nodes seeded
                                                     ▼  with fused embeddings
                                     Graph Neural Network (Alg 8)
                                                     │
                                     Explainable AI layer (Alg 9)
                                                     ▼
                                  Personalized drug recommendation
```

## Files

| File | Algorithm | What it is |
|---|---|---|
| `data_synthetic.py` | — | generates a synthetic multi-modal dataset (clinical, genomic, KG reference tables) with realistic structure |
| `genomic_encoding.py` | (3/4 shared) | turns long-format genomic variants into fixed-length token sequences |
| `models/random_forest_model.py` | 1 | Random Forest baseline on tabular clinical data |
| `models/xgboost_model.py` | 2 | gradient-boosted trees (real XGBoost if installed, else automatic sklearn fallback) |
| `models/cnn_model.py` | 3 | 1D-CNN over the genomic variant sequence |
| `models/bilstm_model.py` | 4 | bidirectional LSTM over the same sequence |
| `models/autoencoder_model.py` | 5 | unsupervised compression of the clinical feature matrix |
| `models/fusion_model.py` | 6 | attention-weighted fusion of all four modalities into one patient embedding |
| `knowledge_graph.py` | 7 | patient/drug/allergy/gene/variant graph with the 5 specified edge types |
| `gnn_model.py` | 8 | link-prediction GCN, seeded with the fused patient embeddings as node features |
| `explainability.py` | 9 | permutation importance (RF/XGB), saliency (CNN/Bi-LSTM), perturbation-based edge importance (GNN) |
| `pipeline.py` | — | standalone CLI: trains everything and runs one demo recommendation, then exits |
| `clinical_rules.py` | — | the composite scoring engine: one 0-100 Overall Safety Score per drug built from weighted, itemized point deductions (genetic risk, allergy, organ function, pregnancy, age, diagnosis, drug-drug interactions), plus a hard CPIC/allergy/pregnancy/pediatric/renal safety floor that overrides the score when a factor is non-negotiable, and a drug-drug interaction knowledge base (~20 real interaction pairs with mechanism/effect/management) checked against the patient's free-text medication list |
| `drug_rules.json` | — | the 30-drug gene/allergy/severity table, generated directly from the frontend's catalog so the two never drift apart |
| `server.py` | — | **the live backend.** Trains once at startup, then serves real per-patient recommendations to the dashboard over HTTP |

## The composite scoring engine and interaction checker

Every drug gets one **Overall Safety Score (0-100)** rather than a single
opaque risk number. `clinical_rules.py`'s `compute_overall_score()` starts
at 100 and deducts weighted points per factor that actually applies to
this patient:

| Factor | Points deducted | Notes |
|---|---|---|
| Genetic risk marker (CPIC) | 12 / 30 / 55 (monitor/adjust/risk) | Severity comes from `drug_rules.json` |
| Documented allergy | 12 / 28 / 55 | Same severity scale |
| Kidney impairment | 22 (45 for Metformin specifically) | |
| Liver impairment | 15 | |
| Pregnancy | 35 | |
| Age under 18 (opioid drugs) | 40 | |
| Drug-drug interaction | 6 / 15 / 30 (minor/moderate/major) | See interaction table below |
| Diagnosis-based contraindication | 10 / 20 / 35 (monitor/adjust/risk) | See diagnosis filtering below |
| Multi-modal model residual risk | up to 20 | Backend only — the GNN's learned signal beyond the hard rules above |

The final score maps to a severity band (≥80 Safe, 60-79 Monitor, 35-59
Dose adjustment, <35 Contraindicated) and a plain recommendation. A small
set of factors (CPIC-grade gene/allergy "risk" matches, pregnancy,
pediatric opioid risk, Metformin+renal failure, and any diagnosis rule
tagged "risk") are **hard floors**: they force the Contraindicated band
regardless of what the arithmetic total would otherwise say, because a
statistical score should never be able to dilute an absolute clinical
contraindication. Every score returns the itemized `factors` list
(label, points, plain-language detail) that produced it, so nothing is
a black-box number.

**Diagnosis-based filtering**: `DIAGNOSIS_RULES` covers all 30 catalog
drugs with real, named diagnosis-drug pairings across three severity
tiers — e.g. Ibuprofen + heart failure (risk — NSAID fluid retention
precipitates decompensation), Ibuprofen + hypertension (adjust — blunted
antihypertensive effect), Metformin + decompensated heart failure (risk
— lactic acidosis), Amitriptyline + cardiac conduction disorder (risk —
fast sodium channel blockade). Checked via keyword matching against the
patient's free-text diagnosis field (`check_diagnosis_rules()`), the
same substring-matching approach as the interaction checker, since
diagnosis is collected as free text rather than a fixed dropdown.
Any matched diagnosis, gene marker, or allergy also sets a **minimum
severity** equal to its own tier ("adjust" → at least Dose adjustment,
score capped at 59; "monitor" → at least Monitor, capped at 79).
Without this, a single deduction could leave the drug in a higher band
than its declared tier: a lone diagnosis hit (-20) landed exactly on
the Safe boundary (80/100), and a "monitor"-tier gene hit (-12 = 88)
displayed "Safe to use" for a patient who actually carries the marker. Because matching is by keyword, a diagnosis written in
unusual wording (or misspelled) won't trigger a rule — the
free-text field is the main limitation until it becomes a coded
(e.g. ICD-10) selector.

**Drug-drug interactions** are checked separately: `DRUG_INTERACTIONS` is
a table of ~20 real, named interaction pairs (e.g. Warfarin + Fluconazole
→ major, CYP2C9 inhibition, ↑INR/↑bleeding risk, with a management note),
substring-matched against the patient's free-text current-medications
field. Hits feed into the composite score above and are also returned as
a separate `interactions` list so the dashboard can render a dedicated
"⚠ Drug interaction detected" callout with the mechanism, effect, and
management advice, not just a generic flag.

The frontend (`app.js`) carries an exact structural mirror of this same
scoring and interaction logic for its local rule-based fallback, so
behavior doesn't drift depending on whether `server.py` is running --
the only difference is the backend additionally folds in the trained
multi-modal model's residual risk contribution, which the offline
fallback has no model to compute.

## Connecting this to the dashboard (the live setup)

This is what replaces the dashboard's old rule-based scoring with the
real multi-modal pipeline: `server.py` trains all nine algorithms once
when it starts, then for every patient you submit from the dashboard it
actually runs them — Random Forest and XGBoost on the clinical features,
CNN and Bi-LSTM on the genomic markers, an Autoencoder on the same
clinical features, an attention Fusion Network combining all four, and
finally a Graph Neural Network that inserts this patient as a real node
in the knowledge graph (connected to their checked gene/allergy nodes)
and predicts compatibility against every drug node — all evaluated
together, not chained sequentially. A small hard-rule floor
(`clinical_rules.py`) still enforces non-negotiable CPIC/FDA
contraindications on top of the model's score, the way real
pharmacogenomic decision-support systems do.

**Run it (two terminals):**

Terminal 1 — start the backend:
```bash
cd research
pip install -r requirements.txt
python -m uvicorn server:app --host 127.0.0.1 --port 8420
```
First startup takes roughly 1-3 minutes (it's training 6 models). You'll
see `[startup] ready.` when it's done. Leave this terminal running.

Terminal 2 — serve the frontend:
```bash
cd frontend
python -m http.server 8000
```
Then open `http://localhost:8000/genomx-advisor.html` and use the
Dashboard as normal.

**How the frontend knows which mode it's in:** the Dashboard shows a
badge above the results — green "Multi-modal engine" when it successfully
reached the backend, amber "Rule-based fallback" if it couldn't (backend
not running, wrong port, etc). The dashboard always works either way; the
backend just makes the recommendation come from the real trained models
instead of the local JavaScript rule engine.

**Windows-specific note:** if `python` isn't recognized, use `py` instead
(`py -m uvicorn server:app ...`). If port 8420 is already in use, change
`--port` here and update `BACKEND_URL` near the top of `app.js` to match.

## Setup (standalone, no dashboard)

```bash
pip install -r requirements.txt
python pipeline.py --epochs 60 --gnn-epochs 80 --patient-id P000001 --allergies "PENICILLIN"
```

With no data present it auto-generates a synthetic dataset (`data/`) with
realistic structure (renal/hepatic impairment, allergy count, and PGx risk
alleles all genuinely drive the synthetic ADR-risk label, so the models
have real signal to find). Point `--data-dir` at your own directory with
matching CSVs to use real data instead — see the column names each model
file expects in its preprocessing function.

Run any single stage on its own for faster iteration, e.g.:
```bash
python -m models.random_forest_model
python knowledge_graph.py
```

## Design notes / where I made judgment calls

The document's algorithms describe each model's *shape* but not every
implementation detail (e.g., what exactly Algorithm 3's CNN classifies,
or how Algorithm 6's attention mechanism should be structured). I made
these concrete choices, all changeable:

- **CNN / Bi-LSTM supervision target**: both are trained against
  `adr_risk` (the same weak label as the RF/XGB baselines) so their
  embeddings end up genomically *and* clinically meaningful, rather than
  arbitrary. This is a modeling choice, not a genotype-based diagnosis —
  the model never claims a patient's genotype alone determines risk.
- **Fusion attention**: implemented as a per-modality scalar gate (project
  each modality to a common width, score it, softmax across modalities,
  take the weighted sum) — simple and inspectable (`pipeline.py` prints
  the average attention weight per modality each run), rather than a full
  transformer encoder, since the document lists an attention layer as one
  of several valid fusion options.
- **GNN node features for non-patient nodes**: drugs/alleries/genes/variants
  don't have multimodal patient data, so they get a small zero-padded
  type+degree feature at the same width as the fused patient embedding
  (GCNConv needs one consistent feature width across all nodes).
- **Explainability**: real SHAP/GNNExplainer/Integrated-Gradients weren't
  installable in the sandbox this was built in (no internet access — see
  Validation status below), so `explainability.py` uses real, dependency-free
  equivalents (permutation importance, finite-difference saliency,
  perturbation-based edge masking) that are conceptually the same idea and
  produce genuinely interpretable output. Swap-in instructions for the
  exact original techniques are in the file's docstring and in
  `requirements.txt`.

## Validation status (please read)

This was built in a sandbox with **no internet access** for most of the
build, so `torch` and `torch_geometric` couldn't be installed there. A
later attempt found `pypi.org` actually was reachable and `torch` did
install — but the default PyPI wheel pulls in the full CUDA toolkit
(several GB) and this sandbox only had ~4-6GB free disk, so the install
completed but the import failed (it needs its CUDA runtime libs even for
CPU tensors). On a normal machine with more disk space, `pip install
torch` works fine and none of this applies to you. Here's exactly what
was and wasn't verified before delivery:

**Run for real, with real libraries (numbers you can trust):**
- `data_synthetic.py` — generates the full dataset (500 patients, 12 gene
  markers, 30 drugs matching the frontend exactly), inspected the output.
  Caught and fixed one real bug: the diagnosis category literally named
  `"None"` was being silently parsed as a missing value by pandas'
  default NA-string list, dropping ~10% of rows.
- `models/random_forest_model.py` — real scikit-learn training: ~75-79%
  accuracy, sensible feature importances (kidney/liver/weight markers
  rank highest).
- `models/xgboost_model.py` — real training via the sklearn
  `HistGradientBoostingClassifier` fallback path.
- `knowledge_graph.py` — real graph construction (582 nodes: 500
  patients, 30 drugs, 16 allergies, 24 variants, 12 genes; 8,263 edges;
  1 connected component).
- `explainability.py`'s tabular permutation importance — run against the
  real trained Random Forest above.
- `server.py`'s **FastAPI/HTTP layer, RF, and XGBoost paths** — actually
  ran the real server with real `fastapi`/`uvicorn`/`pydantic`, sent real
  HTTP requests via `TestClient` and a real running server, and confirmed:
  the `/health` and `/recommend` endpoints respond correctly; the response
  is fully JSON-serializable (this caught a real bug — a raw
  `numpy.float32` in the response that FastAPI's default encoder doesn't
  reliably serialize, now cast to a native `float`); an 8-year-old patient
  with a CYP2D6 ultrarapid-metabolizer marker correctly gets Codeine
  flagged Contraindicated for **both** the pediatric age rule and the
  gene rule simultaneously, in one response — the parallel-evaluation
  behavior this backend was built for.

**Structurally validated only** (CNN, Bi-LSTM, Autoencoder, Fusion
Network, GNN, `server.py`'s deep-learning inference path, and the
saliency/GNN-explainer functions, plus the full `pipeline.py` end-to-end
run): I wrote a minimal NumPy-based stand-in for the `torch` /
`torch_geometric` APIs these files call (real array math, no real
autograd) and ran every one of them — including a full trained-then-queried
cycle through `server.py`'s inductive GNN patient-insertion logic — without
errors. This confirms every function signature, tensor shape, and
cross-module hand-off is correct, including the trickiest part (inserting
a brand-new patient node into the trained graph and getting per-drug
scores back out). It does **not** confirm learning quality, since the
stand-in doesn't do real gradient descent (weights don't update, so
losses don't meaningfully decrease and accuracy hovers near chance in
that test run).

**What to check once you run it yourself:** watch `server.py`'s startup
log — you should see each model's training loss decrease over its
epochs, not stay flat. Once it says `[startup] ready.`, submit a patient
with a known hard case (e.g. check "HLA-B\*57:01 positive" and look at
Abacavir) and confirm it's flagged Contraindicated — that part is
guaranteed correct regardless of model quality, since it's enforced by
`clinical_rules.py`'s floor, not the learned score. If a model's loss is
flat from epoch 1 once you're running real torch, something's wrong
(most likely a learning-rate or data-alignment issue, not a structural
bug, since the structure has been exercised end-to-end here).

## Connecting real datasets

When you share your real datasets, the cleanest path is:
1. Reshape them into the five CSVs `data_synthetic.py` produces (or point
   `--data-dir` at wherever they already live, provided the column names
   match each model's preprocessing function).
2. Everything downstream — training, fusion, the knowledge graph, the GNN,
   explainability — runs unchanged.

If your real data has a different shape (e.g. real VCF files instead of a
flat variant table, or ICD-coded diagnoses instead of free-text), tell me
the format and I'll adapt `data_synthetic.py`'s loaders (not its synthetic
generator) to match.

### Status on the four dataset sources you linked

I can't fetch any of these myself: my sandbox's network is restricted to a
package-registry whitelist (pypi, npm, github, etc.) and none of
`physionet.org`, `pharmgkb.org` / `clinpgx.org`, `ftp.1000genomes.ebi.ac.uk`,
or `dbarchive.biosciencedbc.jp` are on it — confirmed by testing each
directly (`host_not_allowed`). Two of them are also gated behind your own
account regardless of network access:

- **eICU-CRD**: requires a credentialed PhysioNet account (CITI human-subjects
  training + a signed data use agreement). Only you can complete that.
  I *have* written and tested `loaders/eicu_loader.py` against the real,
  verified v2.0 schema (`allergy.csv`: `patientunitstayid, drugname,
  allergyname, allergyoffset, allergyenteredoffset` — this is exactly the
  schema Algorithm 8 already uses) — download the files yourself, upload
  `patient.csv` / `allergy.csv` / `lab.csv` / `medication.csv` here, and it's
  ready to go. Run `python loaders/eicu_loader.py <folder>` first — it
  prints every file's real header so I can fix any column-name drift
  before we run it for real.
- **PharmGKB → now ClinPGx** (renamed July 30, 2025 — your link redirects
  automatically): downloads still require accepting their data usage terms
  on-site, so I can't fetch it either. `loaders/clinpgx_loader.py` is
  written and tested against the documented clinical-annotation schema
  (`Gene`, `Drug(s)`, `Phenotype(s)`, `Level of Evidence`) and will replace
  the 7 hand-curated gene-drug pairs in `data_synthetic.py` with the real,
  much larger CPIC/PharmGKB-curated set once you upload an export.
- **1000 Genomes** (public, no account needed — just blocked by my sandbox
  network) and **Open TG-GATEs** (registration-gated, and is toxicogenomics
  expression/histopathology data rather than patient genotypes) are a
  different shape of problem: 1000 Genomes gives raw VCF genotypes, not
  star-alleles, so turning it into the `CYP2C19*2`-style tokens this
  pipeline uses needs a translation step (e.g. PharmVar's allele
  definition tables or a tool like PyPGx/Stargazer) — happy to build that
  once I know which genes/populations you actually want. TG-GATEs would
  plug in differently — as a drug-level hepatotoxicity feature, not a
  patient node — so tell me what you want it to *do* in the pipeline and
  I'll scope it properly rather than guess.

**Fastest path forward:** download whichever files you can get to (even a
small subset), upload them here, and I'll wire in the real loaders
immediately — no more guessing at schemas.

## Status update: the files you actually uploaded (real, inspected)

Here's exactly what each uploaded file turned out to be, verified by
opening and parsing it — not assumed from the filename:

- **`sdata2018178.pdf`** — this is the eICU-CRD *descriptive paper*
  (Pollard et al. 2018), not the database itself. It doesn't contain any
  patient rows. You still need the actual CSVs (`patient.csv`,
  `allergy.csv`, etc.) from your credentialed PhysioNet download for
  `loaders/eicu_loader.py` to do anything.
- **`homo_sapiens_core_62_37g_sql.gz`** — decompresses to 35KB of pure
  `CREATE TABLE` statements (schema only), **zero `INSERT` statements,
  zero rows of actual data**.
- **`alt_allele_txt_core_62_37g_table.gz`** — decompresses to a
  **completely empty file (0 bytes)**.
  Both Ensembl files are unusable as-is; you'd need the real per-table
  data dumps (these are normally hundreds of MB–GB per table for a full
  Ensembl core database), not the schema-only/empty exports.
- **The 6 `.CEL` files + `Open-tggates_AllAttribute.tsv`** — these are
  real and I did something with them:
  - `Open-tggates_AllAttribute.tsv` is genuine: 33,566 real TG-GATEs
    experiment records (compound, dose, tissue, timepoint, plus full
    clinical chemistry/hematology). Note it's **Shift-JIS encoded**
    (`encoding='cp932'`), not UTF-8 — `loaders/tggates_loader.py` handles
    this.
  - The 6 `.CEL` files are genuine Affymetrix "Calvin"-format binary
    microarray files. I wrote `loaders/cel_parser.py`, a from-scratch
    binary parser for this format (no library existed in this sandbox
    to do it for me), and validated it six independent ways: the parsed
    array type (`HG-U133_Plus_2`), experiment name, and scan dates all
    exactly match the independently-loaded TSV metadata; the parsed
    probe count is exactly 1,164×1,164=1,354,896, the true known
    geometry of that array; and the byte offset where header-parsing
    stops exactly matches the file's own declared data offset. I'm
    confident it's correct.
  - Joining the two: all 6 arrays are one real experiment — **human
    liver cells (in vitro) treated with alpidem** (a real drug pulled
    from some markets historically for idiosyncratic hepatotoxicity —
    a genuinely on-topic compound for this project) at 3 dose levels
    (Control / Middle 3μM / High 10μM), 2 replicates each, 24h.
  - **Honest limitation**: I can only extract *raw per-probe
    intensities* this way, not gene-level expression. I checked for a
    dose-response signal (replicate correlation matrix, PCA) and found
    none at the raw-probe level — replicates don't even cluster
    together (e.g. PC1 puts the two control replicates at -160 and -25).
    This is expected, not a bug: raw, unnormalized CEL intensities are
    dominated by probe-specific hybridization affinity, not biology.
    Real signal only emerges after RMA (or similar) normalization and
    probeset summarization, which requires the HG-U133_Plus_2 **CDF**
    (probe→probeset mapping file) — not included here, and I can't
    fabricate one. Two ways forward: (a) upload the CDF and I'll add
    real summarization, or (b) run standard preprocessing yourself
    (R/Bioconductor `affy`/`oligo`, or Affymetrix Power Tools) and send
    me the resulting gene-expression matrix directly — the more common
    professional workflow anyway.

**Net effect on the pipeline right now:** none of these four sources are
ready to replace the synthetic data yet — eICU and Ensembl need the
actual data files (not the paper/schema/empty export you have), and
TG-GATEs needs either the CDF or a pre-normalized expression matrix
before it can feed real gene-level features into the CNN/Bi-LSTM models.
The loaders and parser above are built, tested, and waiting for real
inputs the moment you have them.
