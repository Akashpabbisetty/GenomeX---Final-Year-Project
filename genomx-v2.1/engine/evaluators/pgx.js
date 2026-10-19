import { applyMatched, notEvaluable, notApplicable } from './common.js';

const STATE_TEXT = { not_tested: 'has not been tested', unknown: 'result is unknown', indeterminate: 'result is indeterminate', conflicting: 'results conflict' };

// Single gene condition -> 'missing' | 'nomatch' | { match, trigger }
function check(cond, patient) {
  const g = patient.genotypes[cond.gene];
  if (!g || ['not_tested', 'unknown', 'indeterminate', 'conflicting'].includes(g.state)) return { kind: 'missing', gene: cond.gene, st: g?.state || 'not_tested' };
  if (!cond.phenotypeIn.includes(g.phenotype)) return { kind: 'nomatch' };
  return { kind: 'match', trigger: { field: `genotype.${cond.gene}`, value: g.phenotype + (g.diplotype ? ` (${g.diplotype})` : '') } };
}

export function evaluatePgx(rule, ctx) {
  const conds = rule.condition.type === 'pgx_all' ? rule.condition.all : [rule.condition];
  const rs = conds.map(c => check(c, ctx.patient));
  // A gene that is evaluable and does NOT match settles the rule as not applicable, even if another gene is missing.
  if (rs.some(r => r.kind === 'nomatch')) return notApplicable();
  const missing = rs.filter(r => r.kind === 'missing');
  if (missing.length) {
    // Missing/unusable genetic data is NEVER read as a normal genotype.
    const out = notEvaluable(`genotype.${missing[0].gene}`, `${missing[0].gene} ${STATE_TEXT[missing[0].st]}; this rule cannot be applied.`, rule.blocking !== false);
    out.missing = missing.map(m => ({ field: `genotype.${m.gene}`, reason: `${m.gene} ${STATE_TEXT[m.st]}; this rule cannot be applied.`, blocking: rule.blocking !== false }));
    return out;
  }
  return applyMatched(rule, ctx, rs.map(r => r.trigger));
}
