// Action categories, ordered from MOST to LEAST restrictive. This ordering IS the documented precedence
// policy: the overall action for a drug is the highest-precedence category among its findings.
// There is deliberately no numeric score anywhere: a contraindication can never be averaged away.
export const CATEGORIES = ['avoid', 'modify', 'conditional', 'monitor', 'needs_info', 'informational', 'no_flag'];
export const PRECEDENCE = Object.fromEntries(CATEGORIES.map((c, i) => [c, CATEGORIES.length - i]));

export const CATEGORY_LABEL = {
  avoid: 'Avoid / contraindicated (per cited source)',
  modify: 'Alternative or dose modification advised',
  conditional: 'Review required — applies if an unconfirmed condition holds',
  monitor: 'Use with monitoring',
  needs_info: 'Cannot assess — required information missing',
  informational: 'Informational — not assessed or association unverified',
  no_flag: 'No flagged association found in the available rules',
};
export const CATEGORY_SHORT = {
  avoid: 'Avoid', modify: 'Modify', conditional: 'Review', monitor: 'Monitor',
  needs_info: 'Info needed', informational: 'Not assessed', no_flag: 'No flag',
};
export const GENOTYPE_STATES = ['positive', 'negative', 'unknown', 'not_tested', 'indeterminate', 'conflicting'];
export const NEUTRAL_PHENOTYPES = new Set(['negative', 'normal', 'no_variant']);
export const RULE_STATUSES = ['verified', 'verified_secondary', 'citation_pending'];
export const ENGINE_VERSION = '2.0.0';
