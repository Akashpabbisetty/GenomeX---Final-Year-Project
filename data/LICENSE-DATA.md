# Data licences and attribution

| Files | Origin | Licence / obligations |
|---|---|---|
| `guidelines/index.json`, `gene_catalog.json`, the `G:` evidence records, and the guideline-derived text inside `rules/pgx.json` | **ClinPGx** (formerly PharmGKB) guideline annotations and gene table — https://www.clinpgx.org | **CC BY-SA 4.0**. You must attribute ClinPGx, indicate that changes were made (here: restructured, HTML removed, summaries paraphrased in rules), and distribute derivatives under the same licence. ClinPGx data may not be sold (see the ClinPGx data usage policy). |
| `adverse/**` and the drug-name merge in `drugs.json` | **SIDER 4.1** (EMBL) — drug side effects extracted from labels | The uploaded files did **not** include a licence. To the best of my knowledge SIDER is **CC BY-NC-SA 4.0** (non-commercial, share-alike). **Verify at http://sideeffects.embl.de before redistributing or using commercially.** |
| `tggates/**` (rat blood-chemistry statistics derived from Open TG-GATEs) | **Open TG-GATEs** (Toxicogenomics Project / NIBIOHN) | Not included with the upload. Believed CC BY-SA (via NBDC). **Verify at https://dbarchive.biosciencedbc.jp/en/open-tggates/**. Derived statistics only; raw array files are not redistributed. |
| `rules/*.json`, `vocab.json`, `genes.json`, `evidence.json` | Hand-encoded from the cited sources | Inherit the strictest applicable licence above where they paraphrase ClinPGx text. |

Consequence: this project, as distributed, should be treated as **non-commercial and share-alike** unless the licences are separately cleared.
Provenance (file names, SHA-256, record counts, creation dates) is recorded in `sources.json`; regenerate everything with `python3 scripts/ingest/ingest.py --raw <folder-with-the-5-files> --out data`.
