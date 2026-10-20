import { loadDatasetFromFs, evaluatePatient } from '../engine/index.js';
import { BASE, NOW } from './fixtures/reference_cases.js';
import { fileURLToPath } from 'node:url';
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const ds = await loadDatasetFromFs(ROOT);
export const run = (raw, dataset = ds, opts = {}) => evaluatePatient(raw, dataset, { now: NOW, ...opts });
export const drug = (a, id) => a.results.find(r => r.drugId === id);
export const base = (extra = {}, genes = {}) => ({ ...BASE, ...extra, genotypes: Object.fromEntries(Object.entries(genes).map(([g, ph]) => [g, { status: 'result_available', phenotype: ph }])) });
export const cat = (raw, id, dataset) => drug(run(raw, dataset, { include: [id] }), id).overall.category;
// Clone of the dataset's source files, for tests that need a modified dataset.
export const cloneFiles = (d = ds) => JSON.parse(JSON.stringify({ meta: d.meta, genes: d.genes, vocab: d.vocab, evidence: { evidence: d.evidence }, drugs: { drugs: d.drugs }, interactions: d.interactions, geneCatalog: { genes: [...d.geneCatalog.values()] },
  guidelines: { created: '04/05/2026', guidelines: d.guidelines }, adverseIndex: d.adverseIndex, adverseTerms: d.adverseTerms,
  rules: { pgx: { rules: d.rules.filter(r => r.module === 'pgx') }, allergy: { rules: d.rules.filter(r => r.module === 'allergy') }, renal: { rules: d.rules.filter(r => r.module === 'renal') }, age_context: { rules: d.rules.filter(r => ['age', 'breastfeeding'].includes(r.module)) } } }));
