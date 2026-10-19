// Drug–drug interaction module. NO interaction data ships with this release: data/interactions.json is
// "not_configured". The legacy hand-written pairs are quarantined in data/unverified/ and never read here.
// When a verified dataset is configured, pairs are matched on normalised INGREDIENT ids (not substrings).
export function interactionStatus(ds) {
  const i = ds.interactions;
  if (!i || i.status !== 'configured' || !(i.pairs || []).length) return { status: 'not_configured', message: i?.message || 'Interaction screening is not configured.' };
  return { status: 'configured', message: `Screened against ${i.pairs.length} configured pair(s).` };
}

const SEVERITY_TO_CATEGORY = { major: 'modify', moderate: 'monitor', minor: 'informational', unknown: 'conditional' };

export function evaluateInteractions(patient, drugId, ds) {
  if (interactionStatus(ds).status !== 'configured') return [];
  const meds = new Set(patient.currentMedications.filter(m => m.ingredientId && m.ingredientId !== drugId).map(m => m.ingredientId));
  const out = [];
  for (const pr of ds.interactions.pairs) {
    const other = pr.a === drugId ? pr.b : pr.b === drugId ? pr.a : null;
    if (!other || !meds.has(other)) continue;
    out.push({ ruleId: `INT-${pr.a}-${pr.b}`, ruleVersion: pr.version || '1', module: 'interaction', status: pr.status || 'verified',
      category: SEVERITY_TO_CATEGORY[pr.severity] || 'conditional', headline: `Interaction: ${drugId} + ${other} (${pr.severity || 'unclassified'})`,
      rationale: pr.effect || 'Interaction reported by the configured source.', mechanism: pr.mechanism || null, monitoring: pr.management ? [pr.management] : [], limitations: [],
      evidence: (pr.evidence || []).map(id => ds.evidenceById.get(id)).filter(Boolean), evidenceStatus: pr.status || 'verified', strength: null,
      triggers: [{ field: 'currentMedications', value: other }], caveats: [] });
  }
  return out;
}
