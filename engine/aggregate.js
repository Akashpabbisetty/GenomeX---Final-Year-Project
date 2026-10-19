import { PRECEDENCE, CATEGORY_LABEL } from './constants.js';

// Precedence policy (documented in docs/ENGINE.md):
//  1. Every finding is preserved; nothing is dropped, merged or averaged.
//  2. overall.category = the highest-precedence category among findings, where a BLOCKING missing input
//     contributes a `needs_info` pseudo-finding. Order: avoid > modify > conditional > monitor > needs_info > informational > no_flag.
//  3. `no_flag` is returned only when the drug has at least one available rule (verified or citation-pending; the count is always disclosed), all blocking inputs were available, and nothing fired.
export function aggregateDrug({ findings, missingInfo, coverage }) {
  const real = findings.filter(f => !f.annotation);   // annotation-only findings (label notes) never change the category
  const cats = real.map(f => f.category);
  if (missingInfo.some(m => m.blocking)) cats.push('needs_info');
  let category;
  if (cats.length) category = cats.reduce((a, b) => (PRECEDENCE[b] > PRECEDENCE[a] ? b : a));
  else category = coverage.totalRules > 0 ? 'no_flag' : 'informational';
  const drivers = real.filter(f => f.category === category).map(f => f.ruleId);
  return { category, label: CATEGORY_LABEL[category], drivers };
}

export function uncertaintyState(totalRules, evaluableRules, hasConditional, hasMissing) {
  if (totalRules === 0) return 'not_assessed';
  if (evaluableRules === 0) return 'insufficient';
  if (evaluableRules < totalRules || hasConditional || hasMissing) return 'partial';
  return 'complete';
}
