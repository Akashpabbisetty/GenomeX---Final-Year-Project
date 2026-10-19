// Label-derived adverse-effect matching (SIDER). A drug whose label lists an effect that matches a term recorded in the
// patient's history yields an INFORMATIONAL finding only: SIDER has no severity grading, is a label snapshot, and says
// nothing about whether the effect will occur in this patient. `annotation: true` => listed, but it never changes the drug's action category.
export function fmtFreq(desc, lo, hi, placeboHi) {
  let t;
  if (!desc) t = 'frequency not reported';
  else if (/%$/.test(desc)) t = `${desc} of patients`;
  else if (desc === 'postmarketing') t = 'reported post-marketing (frequency not established)';
  else t = `"${desc}"` + (lo != null && hi != null ? ` (SIDER range ${Math.round(lo * 10000) / 100}–${Math.round(hi * 10000) / 100}%)` : '');
  if (placeboHi != null) t += `; placebo ${Math.round(placeboHi * 10000) / 100}%`;
  return t;
}

export function evaluateAdverse(patient, drugId, ds) {
  const out = [], drug = ds.drugById.get(drugId);
  for (const h of patient.history) {
    const row = (ds.adverseByTerm.get(h.cui) || []).find(r => r[0] === drugId);
    if (!row) continue;
    const [, desc, rank] = row;
    out.push({
      ruleId: `ADV-${drugId}-${h.cui}`, ruleVersion: '1', module: 'adverse_label', status: 'label_data', category: 'informational',
      headline: `Label lists “${h.name}” for ${drug.name} — matches a recorded condition/event`,
      rationale: `SIDER (label-derived) lists “${h.name}” among ${drug.name}'s adverse effects (${fmtFreq(desc, null, null, null)}). This is a label listing, not a prediction for this patient; it carries no severity grading.`,
      annotation: true, mechanism: null, monitoring: [], limitations: ['Label snapshot from the mid-2010s; the current label may differ.', 'Frequency words are mapped to ranges by SIDER, not by the original label.'],
      evidence: [ds.evidenceById.get('E-SIDER-4.1')], evidenceStatus: 'label_data', strength: null, triggers: [{ field: 'history', value: h.name }], caveats: [], conditionalOn: null, rank,
    });
  }
  return out;
}
