import { loadDatasetFromFs, evaluatePatient } from '../engine/index.js';
import { BASE, NOW } from './fixtures/reference_cases.js';
export const ROOT = new URL('..', import.meta.url).pathname;
export const ds = await loadDatasetFromFs(ROOT);
export const run = (raw, dataset = ds) => evaluatePatient(raw, dataset, { now: NOW });
export const drug = (a, id) => a.results.find(r => r.drugId === id);
export const base = (extra = {}, genes = {}) => ({ ...BASE, ...extra, genotypes: Object.fromEntries(Object.entries(genes).map(([g, ph]) => [g, { status: 'result_available', phenotype: ph }])) });
export const cat = (raw, id, dataset) => drug(run(raw, dataset), id).overall.category;
