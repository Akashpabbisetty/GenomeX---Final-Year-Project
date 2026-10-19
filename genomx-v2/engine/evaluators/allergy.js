import { notEvaluable, notApplicable } from './common.js';

// status -> category tables. Documented, suspected, intolerance and unknown reactions are NOT interchangeable.
const SAME_CLASS = { documented: 'avoid', suspected: 'conditional', intolerance: 'informational', unknown: 'conditional' };
const CROSS = { documented: 'conditional', suspected: 'informational', intolerance: 'informational', unknown: 'informational' };
const RANK = ['avoid', 'conditional', 'informational'];

export function evaluateAllergy(rule, ctx) {
  const p = ctx.patient;
  if (p.allergyHistoryStatus === 'not_assessed')
    return notEvaluable('allergyHistory', 'Allergy history has not been assessed; absence of entries is not read as "no allergy".', true);
  if (p.allergyHistoryStatus === 'none_known') return notApplicable();
  const entries = p.allergies.filter(a => a.substanceClass === rule.condition.substanceClass);
  if (!entries.length) return notApplicable();
  const table = rule.condition.mode === 'same_class' ? SAME_CLASS : CROSS;
  let best = null;
  for (const a of entries) { const c = table[a.status]; if (!best || RANK.indexOf(c) < RANK.indexOf(best.category)) best = { category: c, entry: a }; }
  const a = best.entry;
  const desc = [a.status, a.reaction && `reaction: ${a.reaction}`, `severity: ${a.severity}`, a.date && `date: ${a.date}`, a.source && `source: ${a.source}`, `confidence: ${a.confidence}`].filter(Boolean).join('; ');
  const caveats = [];
  if (a.status === 'intolerance') caveats.push('Recorded as an intolerance, which is not an allergy; review the reaction.');
  if (a.status === 'suspected' || a.status === 'unknown') caveats.push('The allergy is not confirmed; formal allergy assessment may change this finding.');
  return { outcome: 'applied', category: best.category, triggers: [{ field: `allergy.${rule.condition.substanceClass}`, value: desc }], caveats, missing: [] };
}
