import { applyMatched, notEvaluable, notApplicable } from './common.js';

const STATE_TEXT = {
  not_tested: 'has not been tested', unknown: 'result is unknown', indeterminate: 'result is indeterminate', conflicting: 'results conflict',
};

export function evaluatePgx(rule, ctx) {
  const { gene, phenotypeIn } = rule.condition;
  const g = ctx.patient.genotypes[gene];
  if (!g || ['not_tested', 'unknown', 'indeterminate', 'conflicting'].includes(g.state)) {
    const st = g?.state || 'not_tested';
    // Missing / unusable genetic data is NEVER read as a normal genotype.
    return notEvaluable(`genotype.${gene}`, `${gene} ${STATE_TEXT[st]}; this rule cannot be applied.`, rule.blocking !== false);
  }
  if (!phenotypeIn.includes(g.phenotype)) return notApplicable();
  return applyMatched(rule, ctx, [{ field: `genotype.${gene}`, value: g.phenotype + (g.diplotype ? ` (${g.diplotype})` : '') }]);
}
