import { loadDatasetFromFs } from '../engine/dataset.js';
const ds = await loadDatasetFromFs(new URL('..', import.meta.url).pathname);
const { errors, warnings } = ds.validation;
const byStatus = {}; for (const r of ds.rules) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(`rule-set ${ds.meta.ruleSetVersion}: ${ds.drugs.length} drugs, ${ds.rules.length} rules ${JSON.stringify(byStatus)}, ${ds.evidence.length} evidence records, ${ds.unverifiedByDrug.size} drugs with unverified associations`);
warnings.forEach(w => console.log('WARN ', w)); errors.forEach(e => console.log('ERROR', e));
if (errors.length) { console.log(`\n${errors.length} data error(s)`); process.exit(1); } console.log('data validation passed');
