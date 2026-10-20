import { loadDatasetFromFs } from '../engine/dataset.js';
import { fileURLToPath } from 'node:url';
const ds = await loadDatasetFromFs(fileURLToPath(new URL('..', import.meta.url)));
const { errors, warnings } = ds.validation;
const byStatus = {}; for (const r of ds.rules) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
console.log(`rule-set ${ds.meta.ruleSetVersion}: ${ds.drugs.length} drugs, ${ds.rules.length} rules ${JSON.stringify(byStatus)}, ${ds.evidence.length} evidence records, ${ds.guidelines.length} published guidelines (${ds.guidelinesByDrug.size} drugs), ${ds.geneCatalog.size} catalog genes, SIDER label data for ${Object.keys(ds.adverseIndex.drugs).length} drugs`);
warnings.forEach(w => console.log('WARN ', w)); errors.forEach(e => console.log('ERROR', e));
if (errors.length) { console.log(`\n${errors.length} data error(s)`); process.exit(1); } console.log('data validation passed');
