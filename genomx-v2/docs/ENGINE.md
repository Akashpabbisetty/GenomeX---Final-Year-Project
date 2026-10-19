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

## Action categories and precedence (highest wins)
`avoid` > `modify` > `conditional` > `monitor` > `needs_info` > `informational` > `no_flag`

1. Every finding is preserved (nothing is merged or averaged).
2. A **blocking** missing input adds a `needs_info` pseudo-finding; it can never outrank a real finding but always outranks "no flag".
3. `no_flag` ⇔ the drug has ≥1 available rule, no blocking input is missing, and nothing fired. Text always states that this is **not** a statement of safety/appropriateness.
4. A drug with no rules → `informational` "not assessed". Unverified associations → `informational` only, never `avoid`/`modify`.
5. `conditional` = a rule matches but depends on context that was not supplied (or differs from the rule's population); the finding records the category it *would* be (`conditionalOn`).
6. There is **no numeric score**; a test asserts none exists in results.

## Rule schema (data/rules/*.json)
`id` · `version` · `status` (`verified` | `verified_secondary` | `citation_pending`) · `module` · `drug` · `condition` (`pgx` / `egfr` / `age` / `breastfeeding` / `allergy`) · `requires` (`priorExposure`, `indication`) · `onUnmetContext` · `action` · `strength` · `headline` · `rationale` · `mechanism` · `monitoring[]` · `limitations[]` · `evidence[]` (ids into `evidence.json`) · `evidenceLevel` (always `null`) · `alternatives` · `blocking`.
`npm run validate-data` enforces unique IDs, resolvable evidence, https URLs, valid phenotypes, and "verified ⇒ has non-secondary evidence".

## Per-drug result
`drugId, overall{category,label,drivers}, findings[] (ruleId, ruleVersion, module, status, category, headline, rationale, mechanism, monitoring, limitations, evidence, triggers, caveats), missingInfo[], rulesEvaluated[], coverage, uncertainty (complete|partial|insufficient|not_assessed), alternatives, timestamp, ruleSetVersion`.

## Explanations
Generated only from the rule + evidence record (`explain.js`). No LLM is used. If one is added later it may rephrase, but must not change `category`.

## Extending
Add a rule → add evidence record(s) → `npm run validate-data` → add a reference case with its source in `tests/fixtures/reference_cases.js` → `npm test`. To enable interactions, populate `data/interactions.json` (`status:"configured"`, `pairs[]` with evidence ids).
