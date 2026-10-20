import { DISCLAIMER, ATTRIBUTION } from '../engine/report.js';

/**
 * Maps the raw engine analysis output to the required API response shape.
 * NO numeric score, confidence, or probability fields are included anywhere.
 */
export function buildApiResponse(analysis) {
  const findings = analysis.results;

  const missingInformation = analysis.results.flatMap(r => r.missingInfo);

  // Collect and deduplicate evidence entries by id
  const evidenceMap = new Map();
  for (const r of analysis.results) {
    for (const f of r.findings) {
      for (const e of f.evidence) {
        if (e.id && !evidenceMap.has(e.id)) {
          evidenceMap.set(e.id, e);
        }
      }
    }
  }
  const evidence = [...evidenceMap.values()];

  return {
    ruleSetVersion: analysis.meta.ruleSetVersion,
    disclaimer: DISCLAIMER,
    dataAttributions: ATTRIBUTION,
    findings,
    missingInformation,
    evidence,
    validation: analysis.validation,
    meta: analysis.meta,
    notices: analysis.notices,
  };
}
