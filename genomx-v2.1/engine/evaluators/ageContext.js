import { applyMatched, notEvaluable, notApplicable } from './common.js';

export function evaluateAge(rule, ctx) {
  const a = ctx.patient.age;
  if (a === null) return notEvaluable('age', 'Age was not provided; this age-specific rule cannot be applied.', rule.blocking !== false);
  const { ltYears, gteYears } = rule.condition;
  if ((ltYears != null && !(a < ltYears)) || (gteYears != null && !(a >= gteYears))) return notApplicable();
  return applyMatched(rule, ctx, [{ field: 'age', value: `${a} years` }]);
}

export function evaluateBreastfeeding(rule, ctx) {
  const v = ctx.patient.breastfeeding;
  if (v === 'unknown') return notEvaluable('breastfeeding', 'Breastfeeding status was not provided (select "Not applicable" if it does not apply).', rule.blocking !== false);
  if (v !== rule.condition.equals) return notApplicable();
  return applyMatched(rule, ctx, [{ field: 'breastfeeding', value: v }]);
}
