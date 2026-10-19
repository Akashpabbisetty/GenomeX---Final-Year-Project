import { applyMatched, notEvaluable, notApplicable } from './common.js';

export function evaluateRenal(rule, ctx) {
  const e = ctx.patient.egfr;
  if (e.value === null) return notEvaluable('egfr', 'No eGFR value was provided. A generic "normal/impaired" selection is not used: this rule needs a measured or reported eGFR (mL/min/1.73 m²).', rule.blocking !== false);
  const { lt, gte } = rule.condition;
  if ((lt != null && !(e.value < lt)) || (gte != null && !(e.value >= gte))) return notApplicable();
  const caveats = [];
  if (e.dateMissing) caveats.push('eGFR date is missing, so recency is unknown.');
  if (e.stale) caveats.push(`eGFR is ${e.ageDays} days old (older than 12 months).`);
  return applyMatched(rule, ctx, [{ field: 'egfr', value: `${e.value} ${'mL/min/1.73 m²'}${e.date ? ` (${e.date})` : ''}` }], caveats);
}
