---
inclusion: always
---
# Product: GenomX Advisor (research prototype)
Educational pharmacogenomic medication-safety screening. NOT clinically validated, NOT a medical device.

## Non-negotiable behaviour
- No numeric "safety score". Seven categories, highest precedence wins: avoid > modify > conditional > monitor > needs_info > informational > no_flag.
- Missing/unknown/untested data is never treated as normal. "no_flag" never means safe.
- Only hand-encoded rules with cited evidence may produce avoid/modify. Guideline text is shown as a pointer; label (SIDER) and preclinical (TG-GATEs) data are annotations that never change a category.
- Model predictions are research output, shown separately, and never override rules.
- Never invent clinical facts, interactions, evidence levels, dosing or citations. If a source is unavailable, add an integration point and say so.
- Licences: ClinPGx CC BY-SA 4.0 (attribute, share-alike, no sale); SIDER and TG-GATEs licences must be verified; keep the project non-commercial.
