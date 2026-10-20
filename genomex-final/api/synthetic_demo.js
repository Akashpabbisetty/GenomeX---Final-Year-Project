// synthetic_demo.js — exercises 6 hard-coded synthetic patients through the rule engine.
// SYNTHETIC DATA — not derived from real patients. For testing code paths only. NOT a clinical output.

import { fileURLToPath } from 'node:url';
import { loadDatasetFromFs, evaluatePatient, CATEGORIES } from '../../engine/index.js';

// Project root: two levels up from genomex-final/api/
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const BANNER = 'SYNTHETIC DATA — not derived from real patients. For testing code paths only. NOT a clinical output.';

console.log('\n' + '='.repeat(BANNER.length));
console.log(BANNER);
console.log('='.repeat(BANNER.length) + '\n');

// ---------------------------------------------------------------------------
// Synthetic patients — hard-coded with documented generation rationale.
// None of these records are derived from real patient data.
// ---------------------------------------------------------------------------

const SYNTHETIC_PATIENTS = [
  {
    label: 'patient-1-avoid',
    // HLA-B*57:01 positive → abacavir AVOID (CPIC 2014 update, PMC3994233)
    raw: {
      age: 40,
      allergyHistoryStatus: 'none_known',
      egfrValue: '90',
      egfrDate: '2026-09-01',
      breastfeeding: 'not_applicable',
      genotypes: {
        'HLA-B*57:01': { status: 'result_available', phenotype: 'positive' },
      },
    },
    expectedDrug: 'abacavir',
    expectedCategory: 'avoid',
    opts: {},
  },
  {
    label: 'patient-2-modify',
    // TPMT poor metaboliser + NUDT15 normal → azathioprine MODIFY (CPIC 2018, PMC6576267)
    raw: {
      allergyHistoryStatus: 'none_known',
      egfrValue: '90',
      egfrDate: '2026-09-01',
      breastfeeding: 'not_applicable',
      genotypes: {
        TPMT: { status: 'result_available', phenotype: 'poor' },
        NUDT15: { status: 'result_available', phenotype: 'normal' },
      },
    },
    expectedDrug: 'azathioprine',
    expectedCategory: 'modify',
    opts: {},
  },
  {
    label: 'patient-3-conditional',
    // CYP2C19 poor + unknown indication → clopidogrel CONDITIONAL (CPIC 2022, PMC9287492)
    raw: {
      allergyHistoryStatus: 'none_known',
      egfrValue: '90',
      egfrDate: '2026-09-01',
      breastfeeding: 'not_applicable',
      indication: 'unknown',
      genotypes: {
        CYP2C19: { status: 'result_available', phenotype: 'poor' },
      },
    },
    expectedDrug: 'clopidogrel',
    expectedCategory: 'conditional',
    opts: {},
  },
  {
    label: 'patient-4-needs_info',
    // eGFR missing → metformin NEEDS_INFO (FDA DSC 2016-04-08)
    raw: {
      allergyHistoryStatus: 'none_known',
      egfrValue: '',
      breastfeeding: 'not_applicable',
    },
    expectedDrug: 'metformin',
    expectedCategory: 'needs_info',
    opts: {},
  },
  {
    label: 'patient-5-no_flag',
    // HLA-B*57:01 negative → abacavir NO_FLAG (CPIC 2014, PMC3994233)
    raw: {
      allergyHistoryStatus: 'none_known',
      egfrValue: '90',
      egfrDate: '2026-09-01',
      breastfeeding: 'not_applicable',
      genotypes: {
        'HLA-B*57:01': { status: 'result_available', phenotype: 'negative' },
      },
    },
    expectedDrug: 'abacavir',
    expectedCategory: 'no_flag',
    opts: {},
  },
  {
    label: 'patient-6-informational',
    // Same as patient-5; levothyroxine is in the drug catalog (SIDER only, no PGx rules)
    // → evaluated with include:['levothyroxine'] → overall category: informational
    raw: {
      allergyHistoryStatus: 'none_known',
      egfrValue: '90',
      egfrDate: '2026-09-01',
      breastfeeding: 'not_applicable',
      genotypes: {
        'HLA-B*57:01': { status: 'result_available', phenotype: 'negative' },
      },
    },
    expectedDrug: 'levothyroxine',
    expectedCategory: 'informational',
    opts: { include: ['levothyroxine'] },
  },
];

// ---------------------------------------------------------------------------
// Monitor category note
// ---------------------------------------------------------------------------
console.log('--- monitor category: no rule in the 2026.10.0-prototype release produces this');
console.log('    category. This code path cannot be exercised until a monitor rule is added. ---\n');

// ---------------------------------------------------------------------------
// Load dataset and run evaluations
// ---------------------------------------------------------------------------
const ds = await loadDatasetFromFs(ROOT);

let passCount = 0;
let failCount = 0;

// Accumulate category counts across all results from all patients
const totalByCategory = Object.fromEntries(CATEGORIES.map(c => [c, 0]));

console.log('Running synthetic patients:\n');

for (const spec of SYNTHETIC_PATIENTS) {
  const analysis = evaluatePatient(spec.raw, ds, spec.opts);

  // Accumulate distribution counts from this patient's evaluation
  for (const [cat, count] of Object.entries(analysis.summaryByCategory)) {
    if (cat in totalByCategory) totalByCategory[cat] += count;
  }

  // Find the expected drug's result
  const drugResult = analysis.results.find(r => r.drugId === spec.expectedDrug);
  const actualCategory = drugResult ? drugResult.overall.category : '(drug not found)';
  const pass = actualCategory === spec.expectedCategory;

  if (pass) {
    passCount++;
    console.log(`  PASS  [${spec.label}]  ${spec.expectedDrug} → ${actualCategory}`);
  } else {
    failCount++;
    console.log(`  FAIL  [${spec.label}]  ${spec.expectedDrug} → expected ${spec.expectedCategory}, got ${actualCategory}`);
  }
}

// ---------------------------------------------------------------------------
// Category distribution table
// ---------------------------------------------------------------------------
console.log('\n--- Category distribution across all 6 patient evaluations ---\n');
const maxCatLen = Math.max(...CATEGORIES.map(c => c.length));
for (const cat of CATEGORIES) {
  const count = totalByCategory[cat];
  console.log(`  ${cat.padEnd(maxCatLen)}  ${count}`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passCount} PASS / ${failCount} FAIL`);

// Banner repeated at end
console.log('\n' + '='.repeat(BANNER.length));
console.log(BANNER);
console.log('='.repeat(BANNER.length) + '\n');

if (failCount > 0) process.exit(1);
