import { normalizePatient } from './patient.js';
import { evaluatePgx } from './evaluators/pgx.js';
import { evaluateAllergy } from './evaluators/allergy.js';
import { evaluateRenal } from './evaluators/renal.js';
import { evaluateAge, evaluateBreastfeeding } from './evaluators/ageContext.js';
import { evaluateInteractions, interactionStatus } from './evaluators/interactions.js';
import { evaluateDuplicate } from './evaluators/duplicates.js';
import { evaluateGuidelines } from './evaluators/guidelines.js';
import { evaluateAdverse } from './evaluators/adverse.js';
import { aggregateDrug, uncertaintyState } from './aggregate.js';
import { overallSummary } from './explain.js';
import { ENGINE_VERSION, CATEGORIES } from './constants.js';
import { ruleGenes, loadTermBuckets } from './dataset.js';

export { loadDatasetFromFs, loadDatasetFromUrls, buildDataset, loadAdverseDrug, loadTermBuckets, ruleGenes } from './dataset.js';
export { normalizePatient } from './patient.js';
export * from './constants.js';
export { explainFinding, overallSummary, statusText } from './explain.js';
export { buildReport, reportToCsv } from './report.js';
export { fmtFreq } from './evaluators/adverse.js';

const EVALUATORS = { pgx: evaluatePgx, pgx_all: evaluatePgx, allergy: evaluateAllergy, egfr: evaluateRenal, age: evaluateAge, breastfeeding: evaluateBreastfeeding };
const resolveEvidence = (ds, ids) => (ids || []).map(id => ds.evidenceById.get(id)).filter(Boolean);
const ALT_CATEGORIES = new Set(['avoid', 'modify']);

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

  const gl = evaluateGuidelines(patient, drugId, ds);
  findings.push(...gl.findings);
  for (const m of gl.missing) if (!missingInfo.some(x => x.field === m.field)) missingInfo.push(m);   // a hand rule's blocking entry for the same gene wins
  const dup = evaluateDuplicate(patient, drugId); if (dup) findings.push(dup);
  findings.push(...evaluateInteractions(patient, drugId, ds));
  findings.push(...evaluateAdverse(patient, drugId, ds));

  const verifiedRules = rules.filter(r => r.status !== 'citation_pending').length;
  const related = ds.guidelinesByDrug.get(drugId) || [];
  const coverage = { totalRules: rules.length, verifiedRules, citationPendingRules: rules.length - verifiedRules, guidelines: related.length, labelEffects: ds.adverseIndex.drugs[drugId] || 0 };
  const evaluable = rulesEvaluated.filter(r => r.outcome !== 'not_evaluable').length;
  const overall = aggregateDrug({ findings, missingInfo, coverage });

  const alternatives = [];
  for (const f of findings) { const a = ds.ruleById.get(f.ruleId)?.alternatives; if (a?.supported && ALT_CATEGORIES.has(f.category) && !alternatives.some(x => x.text === a.text))
    alternatives.push({ text: a.text, ruleId: f.ruleId, evidence: resolveEvidence(ds, a.evidence) }); }

  const result = {
    drugId, name: drug.name, class: drug.class, overall, findings, missingInfo, rulesEvaluated, coverage,
    uncertainty: uncertaintyState(rules.length, evaluable, findings.some(f => f.category === 'conditional'), missingInfo.length > 0),
    alternatives: { supported: alternatives, note: 'Alternatives are listed only where a cited guideline names them; none are recommended by this tool.' },
    relatedGuidelines: related.map(g => ({ id: g.id, source: g.source, name: g.name, lastUpdated: g.lastUpdated, url: g.url, recommendation: g.flags.recommendation, summary: g.summary, genes: g.genes })),
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
  const genes = new Set(ds.rules.filter(r => r.status !== 'citation_pending').flatMap(ruleGenes));
  for (const g of genes) items.push({ field: `genotype.${g}`, label: `${g} result`, provided: ['positive', 'negative'].includes(patient.genotypes[g].state) });
  const provided = items.filter(i => i.provided).length;
  return { items, provided, total: items.length, percent: Math.round((provided / items.length) * 100) };
}

export const isGuided = (ds, id) => ds.rulesByDrug.has(id) || ds.guidelinesByDrug.has(id);

// Loads the SIDER shards needed for the patient's recorded terms. Evaluation itself is synchronous.
export async function prepareForPatient(ds, rawPatient = {}) {
  const cuis = (rawPatient.historyTerms || []).map(c => (typeof c === 'string' ? c : c?.cui)).filter(c => /^C\d{7}$/.test(c || ''));
  if (cuis.length && ds.io) await loadTermBuckets(ds, cuis);
}
export async function evaluatePatientAsync(rawPatient, ds, opts = {}) { await prepareForPatient(ds, rawPatient); return evaluatePatient(rawPatient, ds, opts); }

export function evaluatePatient(rawPatient, ds, opts = {}) {
  const now = opts.now || new Date();
  const patient = normalizePatient(rawPatient, ds, now);
  const include = new Set(opts.include || []);
  // scope: 'guided' = drugs with a hand rule or a published guideline (default); 'all' = every catalog drug incl. label-only
  const drugs = opts.scope === 'all' ? ds.drugs : ds.drugs.filter(d => isGuided(ds, d.id) || include.has(d.id));
  const results = drugs.map(d => evaluateDrug(patient, ds, d.id, now));
  const summaryByCategory = Object.fromEntries(CATEGORIES.map(c => [c, results.filter(r => r.overall.category === c).length]));

  const notices = [];
  const ints = interactionStatus(ds);
  if (ints.status !== 'configured') notices.push({ type: 'interaction_not_configured', level: 'warning', message: ints.message });
  const unrec = patient.currentMedications.filter(m => !m.recognised);
  if (unrec.length) notices.push({ type: 'unrecognised_medication', level: 'info', message: `Not in the drug catalog, so not screened: ${unrec.map(m => m.raw).join(', ')}.` });
  for (const id of patient.duplicateIngredients) notices.push({ type: 'duplicate_ingredient', level: 'warning', message: `The same active ingredient (${ds.drugById.get(id).name}) appears more than once in the current medication list.` });
  for (const h of patient.history) if (!ds.adverseByTerm.has(h.cui)) notices.push({ type: 'history_not_loaded', level: 'warning', message: `Label data for “${h.name}” is not loaded, so it could not be matched (use the async evaluation path).` });

  const used = new Set([...ds.rules.flatMap(ruleGenes), ...[...ds.guidelineGeneMap.values()].flat()]);
  const unusedList = [];
  if (patient.pregnancy !== 'unknown') unusedList.push({ field: 'pregnancy', reason: 'Recorded, but no verified pregnancy rule exists in this release, so it did not affect any result.' });
  for (const [g, v] of Object.entries(patient.genotypes)) if (['positive', 'negative'].includes(v.state) && !used.has(g))
    unusedList.push({ field: `genotype.${g}`, reason: 'Recorded, but no rule or published guideline in this release uses this gene.' });

  return {
    meta: { ruleSetVersion: ds.meta.ruleSetVersion, appVersion: ds.meta.appVersion, engineVersion: ENGINE_VERSION, generatedAt: now.toISOString(), status: ds.meta.status, scope: opts.scope || 'guided', evaluatedDrugs: results.length },
    patient, results, summaryByCategory, notices, completeness: completeness(patient, ds), inputsNotUsed: unusedList,
    validation: { errors: patient.errors, warnings: patient.warnings },
  };
}
