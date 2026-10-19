# Requirements — Expand verified rule coverage and validate the engine
1. **As a clinician-reviewer, I want more drugs covered by cited rules.**
   - WHEN a ClinPGx/CPIC guideline's phenotype table is encoded THEN each rule SHALL cite the guideline annotation id and have a reference case in `tests/fixtures/reference_cases.js`.
   - Priority: CYP2D6/CYP2C19 antidepressants, CYP3A5–tacrolimus, warfarin (CYP2C9/VKORC1/CYP4F2), tamoxifen, PPIs, voriconazole, irinotecan (UGT1A1), G6PD drugs.
2. **As a researcher, I want an independent fidelity test (task B).**
   - THE system SHALL compare engine output with CPIC's structured recommendation tables for every phenotype×drug combination encoded, and report agreement/sensitivity/specificity.
3. **As a researcher, I want TG-GATEs validated against human DILI (task C).**
   - WHEN DILIrank is ingested THEN the system SHALL report sensitivity/specificity/PPV of the ALT/AST criterion and alternatives, with CIs, and explain misses (e.g. acetaminophen).
4. **As a user, I want interactions only from a verified source.**
   - IF no licensed/verified dataset is configured THEN the UI SHALL keep saying interaction screening was not performed.
5. Hepatic, pregnancy and disease rules SHALL be added only with a cited source and quantitative inputs (eGFR/CrCl), not "impaired" flags. The unsourced cephalexin–CKD rule stays quarantined until a sourced, CrCl-based version exists.
