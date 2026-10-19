// Preclinical liver-signal annotation (Open TG-GATEs, rat in vivo). Shown ONLY when the patient's recorded history contains a
// liver-related label term AND the drug's rat data meet the signal criterion (ALT or AST >= 2x concurrent control with complete
// group separation). It is an ANNOTATION: it never changes the action category, and its absence is NOT reassurance
// (several well-known human hepatotoxicants are not flagged by this criterion in the provided data).
export function evaluatePreclinical(patient, drugId, ds) {
  const c = ds.tggates.compounds[drugId];
  if (!c || !c.liverEnzymeSignal) return [];
  const hit = patient.history.filter(h => ds.tggates.liverTerms.has(h.cui));
  if (!hit.length) return [];
  return [{
    ruleId: `PRE-${drugId}`, ruleVersion: '1', module: 'preclinical', status: 'preclinical_data', category: 'informational', annotation: true,
    headline: `Rat liver-enzyme signal in Open TG-GATEs — relevant to the recorded liver-related history`,
    rationale: `In Open TG-GATEs rat in-vivo studies of ${c.compound}, ALT and/or AST were at least 2x the concurrent control with complete group separation in ${c.nFlaggedGroups} dose/time group(s) (maximum ALT ${c.maxALTfold}x). This is preclinical data at doses far above therapeutic exposure; it is not evidence about this patient.`,
    mechanism: null, monitoring: [], limitations: ['Rat data (usually 5 animals per group); blood chemistry only; supratherapeutic doses.', 'Absence of a flag is not reassurance: e.g. acetaminophen, diclofenac and isoniazid are not flagged by this criterion in the provided data.'],
    evidence: [ds.evidenceById.get('E-TGGATES')], evidenceStatus: 'preclinical_data', strength: null,
    triggers: hit.map(h => ({ field: 'history', value: h.name })), caveats: [], conditionalOn: null,
  }];
}
