# Requirements — End-to-end working system (patient data in → result out)
1. **As a user, I want to submit a patient record and get a structured result,** so that the system works end to end.
   - WHEN a patient JSON is POSTed to `/api/evaluate` THEN the system SHALL validate it server-side, run the same engine as the UI, and return findings, missing information, evidence and ruleSetVersion.
   - THE response SHALL contain no numeric safety score and SHALL include the disclaimer and data attributions.
2. **As a researcher, I want to run many patients (large data).**
   - WHEN a CSV/Parquet of patient records is supplied THEN a batch CLI SHALL evaluate them and write results with throughput reported.
3. **As a user, I want model output shown separately.**
   - THE UI SHALL show a "Model-based drug–ADR association (research output)" panel from `data/model/assoc_scores.parquet`, labelled non-clinical, never altering categories.
4. **As a security reviewer, I want authentication and audit logging on the API** before any real data is used; real patient data SHALL NOT be used until a security/ethics review is complete.
5. **As a tester, I want a synthetic cohort demo,** clearly labelled synthetic, with documented generation, exercising all code paths.
