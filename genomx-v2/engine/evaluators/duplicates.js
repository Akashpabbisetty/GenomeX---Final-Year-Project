// Duplicate-ingredient detection (engine logic, not clinical knowledge). Class-level therapeutic-duplication
// is NOT implemented because no verified class-duplication source is configured.
export function evaluateDuplicate(patient, drugId) {
  if (!patient.currentMedications.some(m => m.ingredientId === drugId)) return null;
  return { ruleId: 'ENGINE-DUP-001', ruleVersion: '1.0.0', module: 'duplicate', status: 'engine_logic', category: 'informational',
    headline: 'This ingredient is already in the current medication list',
    rationale: 'The candidate drug matches an ingredient the patient is already recorded as taking. Treat the result as a review of an ongoing prescription; avoid unintended duplicate prescribing.',
    mechanism: null, monitoring: [], limitations: ['Matching is by normalised ingredient name only.'], evidence: [], evidenceStatus: 'not_applicable', strength: null,
    triggers: [{ field: 'currentMedications', value: drugId }], caveats: [] };
}
