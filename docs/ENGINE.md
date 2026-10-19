# Decision engine

Pure ES modules in `engine/`, with no DOM or I/O dependency (Node, browser, or a future API can call it).

```
raw input ─► patient.js (validate + normalise) ─► evaluators ─► aggregate.js ─► explain.js / report.js
                                                  pgx · allergy · renal · ageContext · interactions · duplicates
```

## Data states
Genes: `not_tested` (default) · `unknown` · `result_available` (+ phenotype → derived `positive`/`negative`) · `indeterminate` · `conflicting`.
Only a `result_available` result can satisfy a rule. **All other states make the rule *not evaluable*** — never "normal".
Allergy history: `not_assessed` (default) · `none_known` · `recorded`. eGFR: a number (+ date) or absent. Age, breastfeeding, indication, prior exposure: explicit `unknown` defaults.

## Knowledge layers (strongest first)
1. **Hand-encoded rules** (`data/rules/*`, 32): each cites ClinPGx guideline annotations (`G:PA…`, CPIC/DPWG/CPNDS/SEFF-SEOM/RNPGx), primary publications and/or FDA communications. **Only these can produce `avoid` / `modify`.**
2. **Guideline index** (`data/guidelines/index.json`, 217 ClinPGx annotations, 208 drugs): for a gene–drug pair that is *not* hand-encoded, a recorded **non-normal** result produces a *pointer* finding — `conditional` if a guideline carries a recommendation, `informational` if it states none/no action. Sources are shown side by side; **no reconciliation and no parsing of prose into actions**. An untested gene is non-blocking missing information. HLA family symbols match a patient allele only if that allele is named in the guideline text.
3. **Label side effects** (`data/adverse/**`, SIDER 4.1): *annotations* (`annotation:true`) — listed with frequency but **never change a drug's category**. Loaded lazily (per-drug file; per-term shard) so the page loads ~0.6 MB up front.

Scope: `evaluatePatient(raw, ds, {scope:'guided'|'all', include:[ids]})`. Default `guided` = drugs with a rule or a guideline (211); `all` adds ~1,180 label-only drugs, which are always "not assessed".

## Action categories and precedence (highest wins)
`avoid` > `modify` > `conditional` > `monitor` > `needs_info` > `informational` > `no_flag`

1. Every finding is preserved (nothing is merged or averaged).
2. A **blocking** missing input adds a `needs_info` pseudo-finding; it can never outrank a real finding but always outranks "no flag".
3. `no_flag` ⇔ the drug has ≥1 available rule, no blocking input is missing, and nothing fired. Text always states that this is **not** a statement of safety/appropriateness.
4. A drug with no rules → `informational` "not assessed". Unverified associations → `informational` only, never `avoid`/`modify`.
5. `conditional` = a rule matches but depends on context that was not supplied (or differs from the rule's population); the finding records the category it *would* be (`conditionalOn`).
6. There is **no numeric score**; a test asserts none exists in results.

## Rule schema (data/rules/*.json)
`id` · `version` · `status` (`verified` = primary guideline, regulator, or official ClinPGx annotation · `verified_secondary` = third-party summary only · `citation_pending` = no source linked) · `module` · `drug` · `condition` (`pgx` / `pgx_all` (compound) / `egfr` / `age` / `breastfeeding` / `allergy`) · `requires` (`priorExposure`, `indication`) · `onUnmetContext` · `action` · `strength` · `headline` · `rationale` · `mechanism` · `monitoring[]` · `limitations[]` · `evidence[]` (ids into `evidence.json`) · `evidenceLevel` (always `null`) · `alternatives` (`supported:true` only with `evidence[]` — enforced by the validator) · `blocking`.
`npm run validate-data` enforces unique IDs, resolvable evidence, https URLs, valid phenotypes, and "verified ⇒ has non-secondary evidence".

## Per-drug result
`drugId, overall{category,label,drivers}, findings[] (ruleId, ruleVersion, module, status, category, headline, rationale, mechanism, monitoring, limitations, evidence, triggers, caveats), missingInfo[], rulesEvaluated[], coverage, uncertainty (complete|partial|insufficient|not_assessed), alternatives, timestamp, ruleSetVersion`.

## Explanations
Generated only from the rule + evidence record (`explain.js`). No LLM is used. If one is added later it may rephrase, but must not change `category`.

## Extending
Add a rule → add evidence record(s) → `npm run validate-data` → add a reference case with its source in `tests/fixtures/reference_cases.js` → `npm test`. To enable interactions, populate `data/interactions.json` (`status:"configured"`, `pairs[]` with evidence ids).
