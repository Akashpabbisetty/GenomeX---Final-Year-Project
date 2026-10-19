// Measures the engine against the reference set and a random-patient stress sample. Writes docs/metrics.json.
import fs from 'node:fs';
import { loadDatasetFromFs, evaluatePatient, CATEGORIES } from '../engine/index.js';
import { CASES, NOW } from '../tests/fixtures/reference_cases.js';
const ROOT = new URL('..', import.meta.url).pathname;
const ds = await loadDatasetFromFs(ROOT);

// 1) reference-set agreement
let exact = 0; const conf = {}; const fails = [];
const HIGH = new Set(['avoid']); const ACTION = new Set(['avoid', 'modify']);
let tp = 0, fn = 0, fp = 0, tn = 0, atp = 0, afn = 0, afp = 0, atn = 0;
for (const c of CASES) {
  const got = evaluatePatient(c.patient, ds, { now: NOW }).results.find(r => r.drugId === c.drug).overall.category;
  if (got === c.expected) exact++; else fails.push({ id: c.id, expected: c.expected, got });
  conf[`${c.expected}->${got}`] = (conf[`${c.expected}->${got}`] || 0) + 1;
  const e = HIGH.has(c.expected), g = HIGH.has(got); if (e && g) tp++; else if (e) fn++; else if (g) fp++; else tn++;
  const ea = ACTION.has(c.expected), ga = ACTION.has(got); if (ea && ga) atp++; else if (ea) afn++; else if (ga) afp++; else atn++;
}
const ratio = (a, b) => (a + b ? +(a / (a + b)).toFixed(3) : null);

// 2) stress sample: alert burden + missing-data behaviour
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const r = rng(2026); const pick = (a) => a[Math.floor(r() * a.length)];
const N = 5000; let totalAlerts = 0, patientsWithAvoid = 0, needsInfoDrugs = 0, drugEvals = 0, noFlagWithMissingBlocking = 0;
const perCat = Object.fromEntries(CATEGORIES.map(c => [c, 0]));
for (let i = 0; i < N; i++) {
  const genotypes = {};
  for (const g of ds.genes.genes) { const full = r() < 0.5; genotypes[g.id] = full ? { status: 'result_available', phenotype: pick(g.phenotypes) } : { status: pick(['not_tested', 'unknown']) }; }
  const a = evaluatePatient({ age: pick([6, 30, 65]), egfrValue: pick(['', 25, 60, 100]), egfrDate: '2026-08-01', breastfeeding: pick(['no', 'unknown']), allergyHistoryStatus: pick(['none_known', 'not_assessed']), indication: pick(['unknown', 'acs_pci']), genotypes }, ds, { now: NOW });
  let av = false;
  for (const d of a.results) { drugEvals++; perCat[d.overall.category]++; if (['avoid', 'modify', 'conditional'].includes(d.overall.category)) totalAlerts++; if (d.overall.category === 'avoid') av = true; if (d.overall.category === 'needs_info') needsInfoDrugs++; if (d.overall.category === 'no_flag' && d.missingInfo.some(m => m.blocking)) noFlagWithMissingBlocking++; }
  if (av) patientsWithAvoid++;
}
const byStatus = {}; for (const x of ds.rules) byStatus[x.status] = (byStatus[x.status] || 0) + 1;
const drugsWithVerified = ds.drugs.filter(d => (ds.rulesByDrug.get(d.id) || []).some(x => x.status !== 'citation_pending')).length;
const drugsWithAny = ds.drugs.filter(d => (ds.rulesByDrug.get(d.id) || []).length).length;
const out = {
  generatedAt: new Date().toISOString(), ruleSetVersion: ds.meta.ruleSetVersion,
  LIMITATION: 'Reference cases are derived from the SAME sources used to author the rules, and the sample is small. Agreement shows faithful encoding (regression), NOT independent clinical accuracy. Random patients are synthetic and carry no clinical meaning.',
  referenceSet: { cases: CASES.length, exactAgreement: exact, exactAgreementRate: +(exact / CASES.length).toFixed(3), disagreements: fails, confusion: conf,
    avoidDetection: { tp, fn, fp, tn, sensitivity: ratio(tp, fn), specificity: ratio(tn, fp) }, actionableDetection_avoid_or_modify: { tp: atp, fn: afn, fp: afp, tn: atn, sensitivity: ratio(atp, afn), specificity: ratio(atn, afp) } },
  coverage: { drugsInCatalog: ds.drugs.length, drugsWithVerifiedRule: drugsWithVerified, drugsWithAnyRule: drugsWithAny, drugsWithOnlyUnverifiedAssociations: ds.unverifiedByDrug.size, rulesByStatus: byStatus, evidenceRecords: ds.evidence.length },
  stress: { randomPatients: N, drugEvaluations: drugEvals, categoryShare: Object.fromEntries(Object.entries(perCat).map(([k, v]) => [k, +(v / drugEvals).toFixed(4)])),
    meanAlertsPerPatient_avoid_modify_conditional: +(totalAlerts / N).toFixed(2), patientsWithAtLeastOneAvoid: +(patientsWithAvoid / N).toFixed(3), needsInfoShare: +(needsInfoDrugs / drugEvals).toFixed(3), noFlagWithBlockingMissing_mustBeZero: noFlagWithMissingBlocking },
};
fs.writeFileSync(new URL('../docs/metrics.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ reference: out.referenceSet.exactAgreement + '/' + out.referenceSet.cases, avoid: out.referenceSet.avoidDetection, actionable: out.referenceSet.actionableDetection_avoid_or_modify, coverage: out.coverage, stress: out.stress }, null, 1));
