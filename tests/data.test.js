import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ds, run, drug, base, ROOT } from './helpers.js';
import { loadTgGates, evaluatePatientAsync, loadAdverseDrug, loadTermBuckets, isGuided, fmtFreq, prepareForPatient } from '../engine/index.js';
import { NOW } from './fixtures/reference_cases.js';
import { ruleGenes, bucketFile } from '../engine/dataset.js';

const json = (p) => JSON.parse(fs.readFileSync(ROOT + p, 'utf8'));

// ---------------- provenance & licensing ----------------
test('sources.json records provenance, hashes, licences and obligations for every ingested dataset', () => {
  const s = json('data/sources.json').sources; assert.deepEqual(s.map(x => x.id).sort(), ['clinpgx-genes', 'clinpgx-guidelines', 'sider', 'tggates']);
  for (const x of s) { assert.ok(x.license); assert.ok(x.sha256); }
  const by = Object.fromEntries(s.map(x => [x.id, x]));
  assert.match(by['clinpgx-guidelines'].license, /CC BY-SA 4\.0/); assert.match(by['clinpgx-guidelines'].obligations, /ShareAlike/); assert.match(by.sider.license, /VERIFY/); assert.match(by.tggates.license, /VERIFY/);
  assert.equal(by['clinpgx-guidelines'].records, ds.guidelines.length);
});
test('guideline index carries the ClinPGx attribution and every URL is https', () => {
  assert.match(ds.guidelineAttribution, /ClinPGx.*CC BY-SA 4\.0/); for (const g of ds.guidelines) assert.match(g.url, /^https:\/\/www\.clinpgx\.org\/guidelineAnnotation\/PA\d+$/);
});

// ---------------- ingested guideline data ----------------
test('guideline index: 217 unique guidelines; sources are CPIC/DPWG/RNPGx/CPNDS etc.; every drug id resolves; dates are ISO', () => {
  assert.equal(ds.guidelines.length, 217); assert.equal(new Set(ds.guidelines.map(g => g.id)).size, 217);
  const srcs = new Set(ds.guidelines.map(g => g.source)); for (const need of ['CPIC', 'DPWG']) assert.ok(srcs.has(need));
  for (const g of ds.guidelines) { assert.ok(g.summary.length > 10, g.id); assert.ok(!/<\/?[a-z][^>]*>/i.test(g.summary), `HTML tag left in ${g.id}`); if (g.lastUpdated) assert.match(g.lastUpdated, /^\d{4}-\d{2}-\d{2}$/); for (const d of g.drugs) assert.ok(ds.drugById.has(d.drugId)); }
});
test('catalog: guided drugs = those with a hand rule or a published guideline; scope "all" covers every drug', () => {
  const guided = ds.drugs.filter(d => isGuided(ds, d.id)).length; assert.ok(guided >= 208);
  assert.equal(run(base()).results.length, guided); assert.equal(run(base(), ds, { scope: 'all' }).results.length, ds.drugs.length);
  assert.equal(run(base(), ds, { include: ['levothyroxine'] }).results.length, guided + 1);
});
test('every original catalog drug id still exists with its class', () => { for (const id of ['abacavir', 'metformin', 'trimethoprim-sulfamethoxazole', 'fluorouracil']) assert.ok(ds.drugById.get(id).class, id); });

// ---------------- cross-check: hand rules vs. the guideline data ----------------
test('every hand-encoded PGx rule is covered by >=1 published guideline for the SAME drug and the same gene', () => {
  for (const r of ds.rules.filter(r => r.module === 'pgx')) for (const gene of ruleGenes(r)) {
    const gls = (ds.guidelinesByDrug.get(r.drug) || []).filter(g => (ds.guidelineGeneMap.get(g.id) || []).includes(gene));
    assert.ok(gls.length >= 1, `${r.id}: no guideline in the dataset for ${r.drug} + ${gene}`);
  }
});
test('every cited G: guideline is for the rule\'s drug and names one of the rule\'s genes', () => {
  for (const r of ds.rules.filter(r => r.module === 'pgx')) for (const id of r.evidence.filter(e => e.startsWith('G:'))) {
    const g = ds.guidelineById.get(id.slice(2)); assert.ok(g.drugs.some(d => d.drugId === r.drug), `${r.id} cites ${id} for another drug`);
    const symbols = ruleGenes(r).map(x => ds.geneById.get(x).symbol); assert.ok(g.genes.some(s => symbols.includes(s)), `${r.id} cites ${id} for other genes`);
  }
});
test('every CPIC-sourced hand rule cites at least one CPIC guideline annotation; hand rules never contradict a "no recommendation" guideline', () => {
  for (const r of ds.rules.filter(r => r.module === 'pgx')) { const cites = r.evidence.filter(e => e.startsWith('G:')).map(e => ds.guidelineById.get(e.slice(2)));
    // Only require a CPIC citation when at least one CPIC annotation exists in the index for this drug
    const cpicExistsForDrug = (ds.guidelinesByDrug.get(r.drug) || []).some(g => g.source === 'CPIC');
    if (cpicExistsForDrug) assert.ok(cites.some(g => g.source === 'CPIC'), r.id);
    assert.ok(cites.some(g => g.flags.recommendation), r.id); }
});
test('gene panel: every panel gene maps to a ClinPGx catalog symbol; CPIC-flag genes in rules are flagged in the gene table', () => {
  for (const g of ds.genes.genes) assert.ok(ds.geneCatalog.has(g.symbol), g.id);
  for (const r of ds.rules.filter(r => r.module === 'pgx' && r.evidence.some(e => e.startsWith('G:') && ds.guidelineById.get(e.slice(2)).source === 'CPIC')))
    for (const gene of ruleGenes(r)) assert.ok(ds.geneCatalog.get(ds.geneById.get(gene).symbol).hasCpicGuideline, `${gene} not flagged as having a CPIC guideline`);
});

// ---------------- alternatives only where a guideline supports them ----------------
test('alternatives are returned only for avoid/modify findings, with evidence; none invented', () => {
  const r = drug(run(base({ indication: 'acs_pci' }, { CYP2C19: 'poor' })), 'clopidogrel');
  assert.equal(r.overall.category, 'modify'); assert.ok(r.alternatives.supported[0].text.includes('Prasugrel or ticagrelor')); assert.ok(r.alternatives.supported[0].evidence[0].url.startsWith('https://'));
  const cond = drug(run(base({}, { CYP2C19: 'poor' })), 'clopidogrel'); assert.equal(cond.alternatives.supported.length, 0);   // conditional => no alternative offered
  assert.equal(drug(run(base({}, { 'HLA-B*57:01': 'positive' })), 'abacavir').alternatives.supported.length, 0);
});

// ---------------- SIDER shards ----------------
test('adverse index: per-drug files match the index counts, are sorted by rank, use known CUIs; sample of 40 drugs', async () => {
  const ids = Object.keys(ds.adverseIndex.drugs); assert.ok(ids.length > 1300);
  for (const id of ids.filter((_, i) => i % Math.ceil(ids.length / 40) === 0)) {
    const d = await loadAdverseDrug(ds, id); assert.equal(d.n, ds.adverseIndex.drugs[id]); assert.equal(d.effects.length, d.n);
    for (let i = 1; i < d.effects.length; i++) assert.ok(d.effects[i - 1][5] >= d.effects[i][5], `${id} not sorted`);
    for (const e of d.effects) assert.ok(ds.adverseTerms[e[0]], `${id}: unknown CUI ${e[0]}`);
  }
});
test('adverse shards: the per-term inverted index agrees with the per-drug files (sample of 60 pairs)', async () => {
  const ids = ['aspirin', 'warfarin', 'metformin', 'codeine', 'ibuprofen']; let checked = 0;
  for (const id of ids) { const d = await loadAdverseDrug(ds, id); const pick = d.effects.filter((_, i) => i % Math.ceil(d.effects.length / 12) === 0);
    await loadTermBuckets(ds, pick.map(e => e[0]));
    for (const e of pick) { const row = (ds.adverseByTerm.get(e[0]) || []).find(r => r[0] === id); assert.ok(row, `${id}/${e[0]} missing in shard`); assert.equal(row[1], e[1]); checked++; } }
  assert.ok(checked >= 40);
});
test('SIDER merge: duplicate drug names were merged (not double-counted) and the thyroxine mapping is flagged', () => {
  assert.match(ds.drugById.get('levothyroxine').note, /name equivalence/); assert.ok(ds.drugById.get('fluorouracil').sources.sider);
});
test('history term matching: label-listed effects produce INFORMATIONAL findings only and never change the action category', async () => {
  const nausea = Object.entries(ds.adverseTerms).find(([, n]) => n === 'Nausea')[0];
  const a = await evaluatePatientAsync({ ...base({}, { 'HLA-B*57:01': 'negative' }), historyTerms: [nausea] }, ds, { now: NOW, include: ['metformin'] });
  const m = drug(a, 'metformin'); const f = m.findings.find(x => x.module === 'adverse_label');
  assert.ok(f, 'metformin label lists nausea'); assert.equal(f.category, 'informational'); assert.equal(f.status, 'label_data'); assert.match(f.rationale, /not a prediction/); assert.ok(f.evidence[0].url.startsWith('https://doi.org/'));
  assert.equal(drug(a, 'abacavir').overall.category, 'no_flag');            // abacavir label lists nausea too, yet its category is untouched by it
  assert.ok(drug(a, 'abacavir').findings.some(x => x.module === 'adverse_label'));
});
test('history term matching: unknown / malformed terms are rejected; terms whose shard is not loaded are flagged, not ignored', async () => {
  assert.ok(run({ ...base(), historyTerms: ['C9999999'] }).validation.errors.some(e => e.field === 'history'));
  assert.ok(run({ ...base(), historyTerms: ['nonsense'] }).validation.errors.some(e => e.field === 'history'));
  const cui = Object.keys(ds.adverseTerms).find(c => !ds.adverseByTerm.has(c));
  assert.ok(run({ ...base(), historyTerms: [cui] }).notices.some(n => n.type === 'history_not_loaded'));
  await prepareForPatient(ds, { historyTerms: [cui] }); assert.ok(!run({ ...base(), historyTerms: [cui] }).notices.some(n => n.type === 'history_not_loaded'));
});
test('frequency formatting states what is known and does not over-claim', () => {
  assert.equal(fmtFreq('21%', 0.21, 0.21, null), '21% of patients'); assert.match(fmtFreq('postmarketing', 0, 0.001, null), /frequency not established/);
  assert.match(fmtFreq('rare', 0.0001, 0.001, 0.0005), /SIDER range.*placebo/); assert.equal(fmtFreq(null), 'frequency not reported');
});
test('bucket function is stable and bounded', () => { for (const c of ['C0000737', 'C0027497', 'C9999999']) assert.match(bucketFile(c), /by_term\/b\d{2}\.json$/); });

// ---------------- Open TG-GATEs (preclinical) ----------------
const TG = ds.tggates;
test('TG-GATEs index: every compound maps to a unique catalog drug and has a data file with consistent statistics', async () => {
  const ids = Object.keys(TG.compounds); assert.ok(ids.length >= 120); assert.equal(new Set(Object.values(TG.compounds).map(c => c.compound)).size, ids.length);
  for (const id of ids.filter((_, i) => i % 4 === 0)) {
    const d = await loadTgGates(ds, id); assert.equal(d.drug, id); assert.ok(ds.drugById.has(id));
    for (const g of d.groups) { assert.ok(g.nT >= 3 && g.nC >= 3, `${id} group too small`); assert.ok(['Low', 'Middle', 'High'].includes(g.level)); assert.ok(g.unit);
      for (const [ep, v] of Object.entries(g.ep)) { assert.ok(v.nt >= 3 && v.nc >= 3 && v.nt <= g.nT && v.nc <= g.nC, `${id}/${ep} per-endpoint n`); assert.ok(Math.abs(v.tm / v.cm - v.fold) < Math.max(0.01, v.fold * 0.01), `${id}/${ep} fold != tm/cm`); assert.ok(v.p >= 0 && v.p <= 1); } }
    const flagged = d.groups.some(g => ['ALT', 'AST'].some(e => g.ep[e] && g.ep[e].fold >= 2 && g.ep[e].sep)); assert.equal(flagged, d.summary.liverEnzymeSignal, `${id} flag inconsistent`); assert.equal(flagged, TG.compounds[id].liverEnzymeSignal);
  }
});
test('TG-GATEs classification: all 170 compounds accounted for; non-drug toxicants are NOT in the drug catalog; curated additions are flagged', () => {
  const mapped = Object.keys(TG.compounds).length, excluded = TG.excluded.length; assert.equal(mapped + excluded, 170);
  assert.ok(TG.excluded.every(x => x.reason)); for (const x of TG.excluded) assert.ok(!ds.nameIndex.has(x.compound.toLowerCase()), `${x.compound} must not be a catalog drug`);
  assert.ok(ds.drugById.get('nimesulide').curated); assert.ok(!ds.drugById.get('simvastatin').curated);
  const how = Object.values(TG.compounds).reduce((m, c) => (m[c.match] = (m[c.match] || 0) + 1, m), {}); assert.ok(how.exact > 80 && how['salt-form'] >= 4 && how.synonym >= 4 && how['curated-addition'] >= 15, JSON.stringify(how));
});
test('TG-GATEs liver terms are real label terms; the annotation only fires for flagged compounds AND a liver-related recorded term, never changes the category', async () => {
  for (const c of TG.liverTerms) assert.ok(ds.adverseTerms[c], c);
  const hep = 'C0235378'; const base0 = { ...base({}, { SLCO1B1: 'normal' }) };
  const withLiver = await evaluatePatientAsync({ ...base0, historyTerms: [hep] }, ds, { now: NOW });
  const sim = drug(withLiver, 'simvastatin'); const f = sim.findings.find(x => x.module === 'preclinical');
  assert.ok(f && f.annotation && f.category === 'informational'); assert.match(f.rationale, /not evidence about this patient/); assert.equal(f.evidence[0].id, 'E-TGGATES');
  assert.equal(sim.overall.category, 'no_flag', 'annotation must not alter the category');
  const noLiver = await evaluatePatientAsync({ ...base0, historyTerms: [Object.entries(ds.adverseTerms).find(([, n]) => n === 'Nausea')[0]] }, ds, { now: NOW });
  assert.ok(!drug(noLiver, 'simvastatin').findings.some(x => x.module === 'preclinical'), 'non-liver term must not trigger');
  assert.ok(!drug(run(base0), 'simvastatin').findings.some(x => x.module === 'preclinical'), 'no history -> no annotation');
  assert.ok(!drug(withLiver, 'acetaminophen')?.findings.some(x => x.module === 'preclinical'));
});
test('pinned data facts behind the UI caveat: acetaminophen, diclofenac, isoniazid and ketoconazole are NOT flagged (revisit the caveat if this ever changes)', () => {
  for (const id of ['acetaminophen', 'diclofenac', 'isoniazid', 'ketoconazole']) { assert.ok(TG.compounds[id], id); assert.equal(TG.compounds[id].liverEnzymeSignal, false, id); }
  for (const id of ['methapyrilene', 'amiodarone', 'colchicine']) assert.equal(TG.compounds[id].liverEnzymeSignal, true, id);
});
test('coverage reports preclinical availability; catalog size and evidence record for TG-GATEs are present', () => {
  assert.equal(ds.drugs.length, 1418); const r = drug(run(base(), ds, { include: ['nimesulide'] }), 'nimesulide'); assert.equal(r.coverage.preclinical, true); assert.equal(r.overall.category, 'informational');
  assert.match(r.summary, /No rule or published guideline/); assert.equal(ds.evidenceById.get('E-TGGATES').type, 'preclinical_database');
});

test('regression: per-endpoint n is stored (animals lacking a measurement are not counted) — naproxen repeat 15-day liver weight had 4 of 10 treated animals measured', async () => {
  const d = await loadTgGates(ds, 'naproxen'); const g = d.groups.find(x => x.type === 'Repeat' && x.period === '15 day' && x.level === 'High');
  assert.equal(g.nT, 10); assert.equal(g.ep.LIVER_REL.nt, 4); assert.equal(g.ep.LIVER_REL.nc, 5);
});
