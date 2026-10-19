import { normalizePatient } from './patient.js';
import { evaluatePgx } from './evaluators/pgx.js';
import { evaluateAllergy } from './evaluators/allergy.js';
import { evaluateRenal } from './evaluators/renal.js';
import { evaluateAge, evaluateBreastfeeding } from './evaluators/ageContext.js';
import { evaluateInteractions, interactionStatus } from './evaluators/interactions.js';
import { evaluateDuplicate } from './evaluators/duplicates.js';
import { aggregateDrug, uncertaintyState } from './aggregate.js';
import { overallSummary } from './explain.js';
import { ENGINE_VERSION, CATEGORIES } from './constants.js';

export { loadDatasetFromFs, loadDatasetFromUrls, buildDataset } from './dataset.js';
export { normalizePatient } from './patient.js';
export * from './constants.js';
export { explainFinding, overallSummary, statusText } from './explain.js';
export { buildReport, reportToCsv } from './report.js';

const EVALUATORS = { pgx: evaluatePgx, allergy: evaluateAllergy, egfr: evaluateRenal, age: evaluateAge, breastfeeding: evaluateBreastfeeding };
const resolveEvidence = (ds, ids) => (ids || []).map(id => ds.evidenceById.get(id)).filter(Boolean);

export function evaluateDrug(patient, ds, drugId, now = new Date()) {
  const drug = ds.drugById.get(drugId);
  const ctx = { patient, ds, drugId };
  const rules = ds.rulesByDrug.get(drugId) || [];
  const findings = [], missingInfo = [], rulesEvaluated = [];

  for (const rule of rules) {
    const ev = EVALUATORS[rule.condition.type];
    const out = ev ? ev(rule, ctx) : { outcome: 'not_evaluable', missing: [{ field: rule.condition.type, reason: 'No evaluator for this rule type.', blocking: true }], triggers: [], caveats: [] };
    rulesEvaluated.push({ ruleId: rule.id, version: rule.version, outcome: out.outcome === 'applied' ? `applied:${out.category}` : out.outcome });
    for (const m of out.missing || []) if (!missingInfo.some(x => x.field === m.field && x.ruleId === rule.id)) missingInfo.push({ ...m, ruleId: rule.id });
    if (out.outcome === 'applied') findings.push({
      ruleId: rule.id, ruleVersion: rule.version, module: rule.module, status: rule.status, category: out.category,
      headline: rule.headline, rationale: rule.rationale, mechanism: rule.mechanism || null, monitoring: rule.monitoring || [], limitations: rule.limitations || [],
      evidence: resolveEvidence(ds, rule.evidence), evidenceStatus: rule.status, strength: rule.strength || null,
      triggers: out.triggers, caveats: out.caveats || [], conditionalOn: out.conditionalOn || null });
  }

  // unverified associations: informational only, and only when an abnormal result was actually provided
  for (const a of ds.unverifiedByDrug.get(drugId) || []) {
    const g = patient.genotypes[a.gene];
    if (g?.state === 'positive') findings.push({
      ruleId: `UNVERIFIED-${drugId}-${a.gene}`, ruleVersion: '0', module: 'unverified', status: 'unverified', category: 'informational',
      headline: `${a.gene} result recorded; association with ${drugId} not verified in this release`, rationale: a.note, mechanism: null, monitoring: [],
      limitations: ['Consult CPIC / PharmGKB / the FDA label directly.'], evidence: [], evidenceStatus: 'unverified', strength: null,
      triggers: [{ field: `genotype.${a.gene}`, value: g.phenotype }], caveats: [], conditionalOn: null });
  }
  const dup = evaluateDuplicate(patient, drugId); if (dup) findings.push(dup);
  findings.push(...evaluateInteractions(patient, drugId, ds));

  const verifiedRules = rules.filter(r => r.status !== 'citation_pending').length;
  const coverage = { totalRules: rules.length, verifiedRules, citationPendingRules: rules.length - verifiedRules, unverifiedAssociations: (ds.unverifiedByDrug.get(drugId) || []).length };
  const evaluable = rulesEvaluated.filter(r => r.outcome !== 'not_evaluable').length;
  const overall = aggregateDrug({ findings, missingInfo, coverage });
  const result = {
    drugId, name: drug.name, class: drug.class, overall, findings, missingInfo, rulesEvaluated, coverage,
    uncertainty: uncertaintyState(rules.length, evaluable, findings.some(f => f.category === 'conditional'), missingInfo.length > 0),
    alternatives: { supported: rules.flatMap(r => (r.alternatives?.supported ? [r.alternatives.text] : [])), note: 'No evidence-backed alternative is encoded in this release; consult the cited guidance.' },
    timestamp: now.toISOString(), ruleSetVersion: ds.meta.ruleSetVersion,
  };
  result.summary = overallSummary(result);
  return result;
}

export function completeness(patient, ds) {
  const items = [
    { field: 'age', label: 'Age', provided: patient.age !== null },
    { field: 'egfr', label: 'eGFR (value)', provided: patient.egfr.value !== null },
    { field: 'allergyHistory', label: 'Allergy history assessed', provided: patient.allergyHistoryStatus !== 'not_assessed' },
    { field: 'indication', label: 'Indication', provided: patient.indication !== 'unknown' },
    { field: 'breastfeeding', label: 'Breastfeeding status', provided: patient.breastfeeding !== 'unknown' },
  ];
  const genes = new Set(ds.rules.filter(r => r.condition.type === 'pgx' && r.status !== 'citation_pending').map(r => r.condition.gene));
  for (const g of genes) items.push({ field: `genotype.${g}`, label: `${g} result`, provided: ['positive', 'negative'].includes(patient.genotypes[g].state) });
  const provided = items.filter(i => i.provided).length;
  return { items, provided, total: items.length, percent: Math.round((provided / items.length) * 100) };
}

export function evaluatePatient(rawPatient, ds, opts = {}) {
  const now = opts.now || new Date();
  const patient = normalizePatient(rawPatient, ds, now);
  const results = ds.drugs.map(d => evaluateDrug(patient, ds, d.id, now));
  const summaryByCategory = Object.fromEntries(CATEGORIES.map(c => [c, results.filter(r => r.overall.category === c).length]));

  const notices = [];
  const ints = interactionStatus(ds);
  if (ints.status !== 'configured') notices.push({ type: 'interaction_not_configured', level: 'warning', message: ints.message });
  const unrec = patient.currentMedications.filter(m => !m.recognised);
  if (unrec.length) notices.push({ type: 'unrecognised_medication', level: 'info', message: `Not in this release's drug catalog, so not screened: ${unrec.map(m => m.raw).join(', ')}.` });
  for (const id of patient.duplicateIngredients) notices.push({ type: 'duplicate_ingredient', level: 'warning', message: `The same active ingredient (${ds.drugById.get(id).name}) appears more than once in the current medication list.` });

  const referenced = new Set(['age', 'breastfeeding', 'egfr', 'allergy', 'indication']);
  const unused = [];
  if (patient.pregnancy !== 'unknown') unused.push({ field: 'pregnancy', reason: 'Recorded, but no verified pregnancy rule exists in this release, so it did not affect any result.' });
  const verifiedGenes = new Set(ds.rules.filter(r => r.condition.type === 'pgx').map(r => r.condition.gene));
  for (const [g, v] of Object.entries(patient.genotypes)) if (['positive', 'negative'].includes(v.state) && !verifiedGenes.has(g))
    unused.push({ field: `genotype.${g}`, reason: 'Recorded, but no verified rule uses this gene in this release (informational notes only).' });

  return {
    meta: { ruleSetVersion: ds.meta.ruleSetVersion, appVersion: ds.meta.appVersion, engineVersion: ENGINE_VERSION, generatedAt: now.toISOString(), status: ds.meta.status },
    patient, results, summaryByCategory, notices, completeness: completeness(patient, ds), inputsNotUsed: unused,
    validation: { errors: patient.errors, warnings: patient.warnings },
  };
}
