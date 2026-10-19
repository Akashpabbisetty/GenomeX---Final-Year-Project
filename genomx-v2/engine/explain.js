// Explanations are generated ONLY from the structured rule + evidence record. No free-text generation,
// no LLM. If an LLM is ever added it may rephrase these sections but must not change `category`.
import { CATEGORY_LABEL } from './constants.js';

const STATUS_TEXT = {
  verified: 'Verified against a primary source',
  verified_secondary: 'Verified against a secondary summary only — check the primary guideline',
  citation_pending: 'Evidence citation pending — class-level safety check, not a guideline recommendation',
  unverified: 'Unverified association — no recommendation issued',
  engine_logic: 'Engine consistency check — not a clinical guideline',
  not_applicable: '—',
};
export const statusText = (s) => STATUS_TEXT[s] || s;

export function explainFinding(f) {
  return {
    detected: f.headline,
    whyItMatters: f.rationale,
    triggeredBy: f.triggers.map(t => `${t.field}: ${t.value}`),
    mechanism: f.mechanism || 'Not recorded in this release.',
    action: CATEGORY_LABEL[f.category] + (f.conditionalOn ? ` (would be "${CATEGORY_LABEL[f.conditionalOn]}" if the stated condition holds)` : ''),
    monitoring: f.monitoring.length ? f.monitoring : ['None recorded in this release.'],
    evidence: f.evidence.length ? f.evidence.map(e => ({ label: `${e.org}, ${e.year}: ${e.title}`, url: e.url, type: e.type })) : [],
    evidenceStatus: statusText(f.evidenceStatus),
    caveats: f.caveats,
    limitations: f.limitations,
  };
}

export function overallSummary(r) {
  switch (r.overall.category) {
    case 'avoid': return 'At least one verified source advises against this drug for the recorded patient data.';
    case 'modify': return 'A verified source advises an alternative or a modified dose for the recorded patient data.';
    case 'conditional': return 'A finding may apply but depends on information that is missing or differs from the rule\'s population. Clinician review required.';
    case 'monitor': return 'A verified source advises monitoring.';
    case 'needs_info': return `Cannot assess: ${r.missingInfo.filter(m => m.blocking).map(m => m.field).join(', ')} not available. This is NOT a clear result.`;
    case 'informational': return r.coverage.totalRules === 0
      ? 'This release has no verified rules for this drug. It has NOT been assessed — this is not a safety statement.'
      : 'Only informational or unverified notes apply.';
    case 'no_flag': return `No flagged association found in the ${r.coverage.totalRules} rule(s) available for this drug (${r.coverage.verifiedRules} verified, ${r.coverage.citationPendingRules} citation-pending). This does not establish that the drug is appropriate for this patient, and interactions, dosing and indication were not assessed.`;
    default: return '';
  }
}
