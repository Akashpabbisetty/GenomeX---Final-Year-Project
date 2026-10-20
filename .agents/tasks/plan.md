# Implementation Plan — Patient API Integration
## GenomX Advisor · Four Deliverables

**Absolute project root:** `c:\Users\spabbisetty\OneDrive - Infor\Desktop\genomex\GenomeX---Final-Year-Project`

> **OUTPUT LOCATION (updated per user instruction):** All new server, script, and doc files go in `genomex-final/api/` — NOT in `server/` or `scripts/`. Import paths from `genomex-final/api/` use `'../../engine/...'` (two levels up to project root). Tests stay in `tests/` and import server from `'../genomex-final/api/index.js'`. Frontend panel primary stays in `frontend/ui/research-panel.js` (required for the app); an identical copy goes in `genomex-final/api/research-panel.js`.

### Key findings from exploration

- **Engine entry**: `engine/index.js` exports `evaluatePatientAsync(rawPatient, ds, opts)` (async) and `evaluatePatient(rawPatient, ds, opts)` (sync). Both call `normalizePatient` internally. Server uses `evaluatePatientAsync`; batch CLI uses sync `evaluatePatient`.
- **Dataset loading**: `loadDatasetFromFs(root)` from `engine/dataset.js`. From `genomex-final/api/`: use `loadDatasetFromFs(fileURLToPath(new URL('../..', import.meta.url)))`.
- **Pre-existing Windows bug**: `tests/helpers.js` uses `.pathname` → ALL TESTS fail on Windows. Fix is one line (step 0 of FEAT-001); prerequisite to all verification.
- **Validation reuse**: `evaluatePatientAsync` calls `normalizePatient`; `analysis.validation.errors` holds errors. Server returns 422 if `errors.length > 0`.
- **No numeric score**: engine already has none. API response shape: `{ ruleSetVersion, disclaimer, dataAttributions, findings, missingInformation, evidence, validation, meta, notices }`.
- **DISCLAIMER & ATTRIBUTION**: constants in `engine/report.js`.
- **`monitor` category**: no rule in the 2026.10.0-prototype release. Synthetic demo documents this gap.
- **Frontend panel**: `data/model/` exists but is empty. Panel shows "not yet available" on 404 HEAD fetch. Must use `h()` from `frontend/ui/dom.js`, no innerHTML.
- **Test command**: `node --test "tests/*.test.js"` from project root.

---

- [ ] 0. **Fix Windows path bug in `tests/helpers.js`**
      Replace `export const ROOT = new URL('..', import.meta.url).pathname` with:
      ```js
      import { fileURLToPath } from 'node:url';
      export const ROOT = fileURLToPath(new URL('..', import.meta.url));
      ```
      Files: `tests/helpers.js`
      Verify: `node --test "tests/*.test.js"` — all pre-existing tests now pass.

---

### DELIVERABLE 1 — POST /api/evaluate endpoint

- [ ] 1. **Create `genomex-final/api/evaluate.js`** — response-shape builder.
      Export `buildApiResponse(analysis)` → `{ ruleSetVersion, disclaimer, dataAttributions, findings, missingInformation, evidence, validation, meta, notices }`. Import `DISCLAIMER, ATTRIBUTION` from `'../../engine/report.js'`. No numeric score/confidence/probability field.
      Files: `genomex-final/api/evaluate.js`

- [ ] 2. **Create `genomex-final/api/auth.js`** — API-key stub.
      Export `checkAuth(req)`. Reads `x-api-key` vs `process.env.GENOMX_API_KEY`. Must contain `// TODO: ... SECURITY REVIEW REQUIRED` and `// IMPORTANT: Real patient data MUST NOT be used until a full security and ethics review is complete.`
      Files: `genomex-final/api/auth.js`

- [ ] 3. **Create `genomex-final/api/audit.js`** — audit-log stub.
      Export `logAudit({ patientId, ruleSetVersion })`. Appends `{ ts, patientId, ruleSetVersion }` NDJSON to `logs/audit.ndjson` (project root, two levels up). Must contain `// PHI NOTICE: ... NO clinical findings, genotypes, or patient inputs.`
      Files: `genomex-final/api/audit.js`

- [ ] 4. **Create `genomex-final/api/index.js`** — HTTP server.
      Exports `makeHandler(ds)`. Uses `node:http`. All engine imports use `'../../engine/...'`. Entry-point guard starts server on port `process.env.PORT || 3001`. Handler: checkAuth → 401; parse body → 400; `evaluatePatientAsync` → 422 on errors; `buildApiResponse` → `logAudit` → 200. Unknown routes → 404.
      Files: `genomex-final/api/index.js`
      Verify: `node genomex-final/api/index.js` starts without error.

- [ ] 5. **Create `tests/server.test.js`** — endpoint tests.
      Imports `makeHandler` from `'../genomex-final/api/index.js'`. Imports `ds` from `'./helpers.js'`. Tests: valid patient → 200 + required fields + no numeric score; `{ age: -1 }` → 422; `{}` → 200; unknown route → 404; bad JSON → 400; `response.disclaimer === DISCLAIMER`.
      Files: `tests/server.test.js`
      Verify: `node --test "tests/*.test.js"` — all pass.

- [ ] 6. **Create `genomex-final/api/SETUP.md`** — setup and usage doc.
      Covers: starting the server, endpoint spec, auth (GENOMX_API_KEY), audit log location, security warning, data attributions, disclaimer.
      Files: `genomex-final/api/SETUP.md`

---

### DELIVERABLE 2 — Batch CLI

- [ ] 7. **Create `genomex-final/api/batch_evaluate.js`**.
      Header: `// SYNTHETIC / RESEARCH USE ONLY. Real patient data MUST NOT be used until a full security and ethics review is complete.` Reads NDJSON input line by line (node:readline), calls `evaluatePatient` sync, writes NDJSON output with `{ synthetic, batchProcessedAt, ruleSetVersion, patientIndex, validation, summaryByCategory, meta }`. Reports throughput. Engine import: `'../../engine/index.js'`. Root: `fileURLToPath(new URL('../..', import.meta.url))`.
      Files: `genomex-final/api/batch_evaluate.js`
      Verify: create 3-line NDJSON, run script, confirm output + throughput line.

---

### DELIVERABLE 3 — Synthetic cohort demo

- [ ] 8. **Create `genomex-final/api/synthetic_demo.js`**.
      Prints `SYNTHETIC DATA — not derived from real patients.` at start and end. Covers: (i) avoid — HLA-B*57:01 positive → abacavir; (ii) modify — TPMT poor → azathioprine; (iii) conditional — CYP2C19 poor + unknown indication → clopidogrel; (iv) needs_info — missing eGFR → metformin; (v) no_flag — HLA-B*57:01 negative → abacavir; (vi) informational — empty + `include: ['levothyroxine']`. Notes `monitor` gap. Logs PASS/FAIL per expected category. Prints distribution table.
      Files: `genomex-final/api/synthetic_demo.js`
      Verify: `node genomex-final/api/synthetic_demo.js` — banner + PASS lines + distribution + monitor note.

---

### DELIVERABLE 4 — Research output panel stub

- [ ] 9. **Create `frontend/ui/research-panel.js`** (primary, for the app).
      Exports `async function renderResearchPanel(container)`. Uses only `h()` — NO innerHTML. Tries HEAD fetch to `'../../data/model/assoc_scores.parquet'`. Shows "not yet available" message on 404. Always shows model-predictions disclaimer. CSP-safe.
      Files: `frontend/ui/research-panel.js`

- [ ] 10. **Create `genomex-final/api/research-panel.js`** (identical copy for distribution).
       Add file-level comment noting it's a copy of `frontend/ui/research-panel.js`.
       Files: `genomex-final/api/research-panel.js`

- [ ] 11. **Modify `frontend/ui/app.js`** — one import + one call.
       Add `import { renderResearchPanel } from './research-panel.js';` at top. After `renderMethodology(...)` call, add `renderResearchPanel($('#view-about'));`. No other changes.
       Files: `frontend/ui/app.js`
       Verify: `node --test "tests/*.test.js"` passes.

---

### End-to-end verification (record actual output)

- [ ] 12. Run `node --test "tests/*.test.js"` — paste pass/fail counts.
- [ ] 13. Run `node genomex-final/api/index.js` — confirm startup log with ruleSetVersion.
- [ ] 14. POST minimal patient to `http://localhost:3001/api/evaluate` — confirm required fields, no score key.
- [ ] 15. Run `node genomex-final/api/synthetic_demo.js` — confirm SYNTHETIC banner + distribution.
- [ ] 16. Stop server. Record all files created/modified.

