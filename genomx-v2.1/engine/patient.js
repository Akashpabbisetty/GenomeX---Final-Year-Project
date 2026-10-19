// Input validation + patient-context normalization. NOTHING is inferred from an empty field:
// absent genotype = not_tested, absent eGFR = null, absent allergy assessment = not_assessed.
import { NEUTRAL_PHENOTYPES } from './constants.js';

const YES_NO = ['yes', 'no', 'unknown', 'not_applicable'];
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s);
const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));

export function normalizeMedicationName(raw, ds) {
  const original = String(raw ?? '').trim();
  const cleaned = original.toLowerCase().replace(/\b\d+([.,]\d+)?\s*(mg|mcg|µg|g|ml|iu|units?|%)\b/g, ' ')
    .replace(/\b(tablets?|tabs?|capsules?|caps?|daily|bid|tid|qid|od|prn|po|iv|oral)\b/g, ' ').replace(/[(),;]/g, ' ').replace(/\s+/g, ' ').trim();
  let id = ds.nameIndex.get(cleaned) ?? null;
  if (!id && cleaned) { const first = cleaned.split(' ')[0]; id = ds.nameIndex.get(first) ?? null; }
  if (!id && cleaned) for (const [k, v] of ds.nameIndex) if (k.length > 5 && k.includes('-') === false && new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(cleaned)) { id = v; break; }
  return { raw: original, ingredientId: id, recognised: !!id };
}

export function normalizePatient(raw = {}, ds, now = new Date()) {
  const errors = [], warnings = [];
  const e = (field, message) => errors.push({ field, message }), w = (field, message) => warnings.push({ field, message });
  const p = { pseudonym: null, age: null, pregnancy: 'unknown', breastfeeding: 'unknown', egfr: { value: null, unit: 'mL/min/1.73 m²', date: null, ageDays: null, stale: false, dateMissing: false },
    indication: 'unknown', allergyHistoryStatus: 'not_assessed', allergies: [], genotypes: {}, currentMedications: [], priorExposure: {}, errors, warnings };

  if (raw.pseudonym) p.pseudonym = String(raw.pseudonym).slice(0, 40);

  const age = num(raw.age);
  if (raw.age !== '' && raw.age != null && age === null) e('age', 'Age must be a number of years (e.g. 42 or 0.5).');
  else if (age !== null && (age < 0 || age > 120)) e('age', 'Age must be between 0 and 120 years.');
  else p.age = age;

  for (const f of ['pregnancy', 'breastfeeding']) {
    const v = raw[f] ?? 'unknown';
    if (!YES_NO.includes(v)) e(f, `${f} must be one of: ${YES_NO.join(', ')}.`); else p[f] = v;
  }
  if (p.pregnancy === 'yes' && p.age !== null && p.age < 8) w('pregnancy', 'Pregnancy recorded for a very young patient — please check age and pregnancy status.');

  const ev = num(raw.egfrValue);
  if (raw.egfrValue !== '' && raw.egfrValue != null && ev === null) e('egfrValue', 'eGFR must be a number in mL/min/1.73 m².');
  else if (ev !== null && (ev < 0 || ev > 200)) e('egfrValue', 'eGFR must be between 0 and 200 mL/min/1.73 m² — check the value and units.');
  else if (ev !== null) {
    p.egfr.value = ev;
    if (!raw.egfrDate) { p.egfr.dateMissing = true; w('egfrDate', 'eGFR date not provided: recency cannot be assessed.'); }
    else if (!isoDate(raw.egfrDate)) { e('egfrDate', 'eGFR date must be a valid date (YYYY-MM-DD).'); p.egfr.dateMissing = true; }
    else {
      const days = Math.floor((now - new Date(raw.egfrDate + 'T00:00:00Z')) / 86400000);
      if (days < 0) { e('egfrDate', 'eGFR date is in the future.'); p.egfr.dateMissing = true; }
      else { p.egfr.date = raw.egfrDate; p.egfr.ageDays = days; p.egfr.stale = days > 365; if (p.egfr.stale) w('egfrDate', 'eGFR is older than 12 months; some labels advise at least annual measurement.'); }
    }
  }

  p.indication = ds.vocab.indications.some(i => i.id === raw.indication) ? raw.indication : 'unknown';
  if (raw.indication && p.indication === 'unknown' && raw.indication !== 'unknown') w('indication', 'Unrecognised indication ignored.');

  // genotypes: every gene defaults to not_tested
  for (const g of ds.genes.genes) {
    const r = raw.genotypes?.[g.id] || {};
    const status = ['not_tested', 'unknown', 'result_available', 'indeterminate', 'conflicting'].includes(r.status) ? r.status : 'not_tested';
    let phenotype = null, state = status === 'result_available' ? 'unknown' : status;
    if (status === 'result_available') {
      if (!g.phenotypes.includes(r.phenotype)) { e(`genotype.${g.id}`, `Choose a phenotype/result for ${g.label}, or change the status.`); state = 'unknown'; }
      else { phenotype = r.phenotype; state = new Set([...NEUTRAL_PHENOTYPES, ...(g.neutralPhenotypes || [])]).has(phenotype) ? 'negative' : 'positive'; }
    }
    p.genotypes[g.id] = { status, phenotype, state, diplotype: r.diplotype ? String(r.diplotype).slice(0, 40) : null };
  }

  // medications
  const seen = new Map();
  for (const m of raw.currentMedications || []) {
    const n = normalizeMedicationName(typeof m === 'string' ? m : m?.name, ds);
    if (!n.raw) continue;
    p.currentMedications.push(n);
    if (n.ingredientId) seen.set(n.ingredientId, (seen.get(n.ingredientId) || 0) + 1);
  }
  p.duplicateIngredients = [...seen].filter(([, c]) => c > 1).map(([id]) => id);

  for (const [drug, v] of Object.entries(raw.priorExposure || {})) if (ds.drugById.has(drug) && ['naive', 'prior', 'unknown'].includes(v)) p.priorExposure[drug] = v;

  // allergies
  p.allergyHistoryStatus = ['not_assessed', 'none_known', 'recorded'].includes(raw.allergyHistoryStatus) ? raw.allergyHistoryStatus : 'not_assessed';
  for (const a of raw.allergies || []) {
    if (!ds.vocab.allergyClasses.some(c => c.id === a.substanceClass)) { e('allergy', `Unknown allergy class "${a.substanceClass}".`); continue; }
    const status = ds.vocab.allergyStatuses.some(s => s.id === a.status) ? a.status : 'unknown';
    if (a.date && !isoDate(a.date)) e('allergy', 'Allergy date must be a valid date (YYYY-MM-DD).');
    p.allergies.push({ substanceClass: a.substanceClass, status, reaction: a.reaction ? String(a.reaction).slice(0, 120) : null,
      severity: ['mild', 'moderate', 'severe', 'unknown'].includes(a.severity) ? a.severity : 'unknown', date: a.date && isoDate(a.date) ? a.date : null,
      source: a.source ? String(a.source).slice(0, 80) : null, confidence: ['high', 'medium', 'low', 'unknown'].includes(a.confidence) ? a.confidence : 'unknown' });
  }
  if (p.allergies.length && p.allergyHistoryStatus !== 'recorded') p.allergyHistoryStatus = 'recorded';
  if (p.allergyHistoryStatus === 'none_known' && p.allergies.length) { w('allergy', 'Entries exist but history is marked "none known"; entries take precedence.'); p.allergyHistoryStatus = 'recorded'; }

  // recorded conditions / prior adverse events (MedDRA preferred terms, by UMLS CUI)
  p.history = [];
  for (const c of raw.historyTerms || []) {
    const cui = typeof c === 'string' ? c : c?.cui;
    if (!/^C\d{7}$/.test(cui || '') || (ds.hasTerms && !ds.adverseTerms[cui])) { e('history', `Unrecognised condition/event term "${String(cui).slice(0, 30)}".`); continue; }
    if (!p.history.some(h => h.cui === cui)) p.history.push({ cui, name: ds.adverseTerms[cui] || cui });
  }
  if (p.history.length > 30) { w('history', 'Only the first 30 recorded terms are used.'); p.history = p.history.slice(0, 30); }

  return p;
}

export function exposureFor(patient, drugId) {
  if (patient.currentMedications.some(m => m.ingredientId === drugId)) return 'current';
  return patient.priorExposure[drugId] || 'unknown';
}
