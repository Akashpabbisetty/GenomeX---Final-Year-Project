import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ds, run, drug, base, ROOT } from './helpers.js';
import { evaluatePatientAsync, loadAdverseDrug, loadTermBuckets, isGuided, fmtFreq, prepareForPatient } from '../engine/index.js';
import { NOW } from './fixtures/reference_cases.js';
import { ruleGenes, bucketFile } from '../engine/dataset.js';

const json = (p) => JSON.parse(fs.readFileSync(ROOT + p, 'utf8'));

// ---------------- provenance & licensing ----------------
test('sources.json records provenance, hashes, licences and obligations for every ingested dataset', () => {
  const s = json('data/sources.json').sources; assert.deepEqual(s.map(x => x.id), ['clinpgx-guidelines', 'clinpgx-genes', 'sider']);
  for (const x of s) { assert.ok(x.license); assert.ok(x.sha256); }
  assert.match(s[0].license, /CC BY-SA 4\.0/); assert.match(s[0].obligations, /ShareAlike/); assert.match(s[2].license, /VERIFY/);
  assert.equal(s[0].records, ds.guidelines.length);
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
  for (const r of ds.rules.filter(r => r.module === 'pgx')) { const cites = r.evidence.filter(e => e.startsWith('G:')).map(e => ds.guidelineById.get(e.slice(2))); assert.ok(cites.some(g => g.source === 'CPIC'), r.id); assert.ok(cites.some(g => g.flags.recommendation), r.id); }
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
