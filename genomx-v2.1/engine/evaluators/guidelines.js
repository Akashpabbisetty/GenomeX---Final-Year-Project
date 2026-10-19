// Guideline-index evaluator. For every drug/gene pair covered by a published guideline (ClinPGx: CPIC, DPWG, ...)
// that is NOT hand-encoded as a rule, a recorded non-normal result produces a *pointer* finding:
//   category = conditional  (a guideline with a recommendation exists; its phenotype-specific action is NOT machine-encoded)
//   category = informational (the guideline states no recommendation / no action needed)
// The engine never turns guideline prose into avoid/modify. Sources are shown side by side; no reconciliation is attempted.
import { ruleGenes } from '../dataset.js';

export function evaluateGuidelines(patient, drugId, ds) {
  const gls = ds.guidelinesByDrug.get(drugId) || [];
  if (!gls.length) return { findings: [], missing: [] };
  const drug = ds.drugById.get(drugId);
  const handGenes = new Set((ds.rulesByDrug.get(drugId) || []).flatMap(ruleGenes));
  const byGene = new Map();
  for (const g of gls) for (const gene of ds.guidelineGeneMap.get(g.id) || []) {
    if (handGenes.has(gene)) continue;
    if (!byGene.has(gene)) byGene.set(gene, []);
    byGene.get(gene).push(g);
  }
  const findings = [], missing = [];
  for (const [gene, list] of byGene) {
    const st = patient.genotypes[gene];
    const label = ds.geneById.get(gene)?.label || gene;
    if (st?.state === 'positive') {
      const actionable = list.some(g => g.flags.recommendation);
      findings.push({
        ruleId: `GL-${drugId}-${gene}`, ruleVersion: '1', module: 'guideline', status: 'guideline_index', category: actionable ? 'conditional' : 'informational',
        headline: `${label} result recorded; published guideline(s) address ${label} and ${drug.name}`,
        rationale: `${actionable ? 'A published guideline with a recommendation exists for this gene–drug pair, but its phenotype-specific action is not machine-encoded here. Read the summaries: ' : 'Published guideline(s) state no recommendation or no action for this pair. '}` +
          list.map(g => `[${g.source}, updated ${g.lastUpdated || 'n.d.'}] ${g.summary}`).join(' || '),
        mechanism: null, monitoring: [], limitations: ['Sources may disagree; no reconciliation is attempted.', 'Summaries are ClinPGx text; the full guideline governs.'],
        evidence: list.map(g => ds.evidenceById.get('G:' + g.id)), evidenceStatus: 'guideline_index', strength: null,
        triggers: [{ field: `genotype.${gene}`, value: st.phenotype }], caveats: ['This is a pointer to published guidance, not an encoded recommendation.'], conditionalOn: null,
        guidelines: list.map(g => ({ id: g.id, source: g.source, lastUpdated: g.lastUpdated, summary: g.summary, url: g.url, recommendation: g.flags.recommendation })),
      });
    } else if (!st || ['not_tested', 'unknown', 'indeterminate', 'conflicting'].includes(st.state)) {
      missing.push({ ruleId: `GL-${drugId}-${gene}`, field: `genotype.${gene}`, blocking: false,
        reason: `${[...new Set(list.map(g => g.source))].join('/')} guideline(s) address ${label} and ${drug.name}; no usable result was provided.` });
    }
  }
  return { findings, missing };
}
