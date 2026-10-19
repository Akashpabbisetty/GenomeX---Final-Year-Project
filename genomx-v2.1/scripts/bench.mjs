import { loadDatasetFromFs, evaluatePatient } from '../engine/index.js';
import { NOW } from '../tests/fixtures/reference_cases.js';
const ds = await loadDatasetFromFs(new URL('..', import.meta.url).pathname);
const genotypes = Object.fromEntries(ds.genes.genes.map(g => [g.id, { status: 'result_available', phenotype: g.phenotypes[g.phenotypes.length - 1] }]));
const p = { age: 8, egfrValue: 25, egfrDate: '2026-09-01', allergyHistoryStatus: 'recorded', allergies: [{ substanceClass: 'penicillin', status: 'documented' }], currentMedications: ['warfarin', 'Plavix', 'metformin'], genotypes };
for (let i = 0; i < 200; i++) evaluatePatient(p, ds, { now: NOW });           // warm-up
const N = 5000, t0 = performance.now(); for (let i = 0; i < N; i++) evaluatePatient(p, ds, { now: NOW }); const ms = performance.now() - t0;
console.log(`new engine: ${N} full analyses (${ds.drugs.filter(d => ds.rulesByDrug.has(d.id) || ds.guidelinesByDrug.has(d.id)).length} drugs each) in ${ms.toFixed(0)} ms -> ${(ms / N).toFixed(3)} ms per analysis`);
