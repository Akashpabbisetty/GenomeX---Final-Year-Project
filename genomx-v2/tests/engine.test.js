import test from 'node:test';
import assert from 'node:assert/strict';
import { ds, run, drug, base, cat } from './helpers.js';
import { CASES, NOW } from './fixtures/reference_cases.js';
import { evaluatePatient, normalizePatient, buildDataset, reportToCsv, buildReport, CATEGORIES, PRECEDENCE } from '../engine/index.js';

// ---------------- dataset integrity ----------------
test('dataset: schema validation passes with no errors', () => assert.deepEqual(ds.validation.errors, []));
test('dataset: every rule resolves its evidence and every non-pending rule has evidence', () => {
  for (const r of ds.rules) {
    for (const id of r.evidence) assert.ok(ds.evidenceById.has(id), `${r.id} -> ${id}`);
    if (r.status !== 'citation_pending') assert.ok(r.evidence.length > 0, r.id);
  }
});
test('dataset: no rule claims a CPIC evidence level (levels were not retrievable)', () => { for (const r of ds.rules) assert.equal(r.evidenceLevel, null, r.id); });
test('dataset: all evidence URLs are https', () => { for (const e of ds.evidence) assert.match(e.url, /^https:\/\//); });
test('dataset validator catches: duplicate rule id, unknown evidence, verified-without-evidence, bad phenotype, unknown drug', () => {
  const files = (mut) => {
    const clone = JSON.parse(JSON.stringify({ meta: ds.meta, genes: ds.genes, vocab: ds.vocab, evidence: { evidence: ds.evidence }, drugs: { drugs: ds.drugs }, interactions: ds.interactions,
      unverified: { associations: [...ds.unverifiedByDrug.values()].flat() }, rules: { pgx: { rules: ds.rules.filter(r => r.module === 'pgx') }, allergy: { rules: [] }, renal: { rules: [] }, age_context: { rules: [] } } }));
    mut(clone); return buildDataset(clone).validation.errors;
  };
  assert.ok(files(c => c.rules.pgx.rules.push({ ...c.rules.pgx.rules[0] })).some(e => /duplicate rule id/.test(e)));
  assert.ok(files(c => { c.rules.pgx.rules[0].evidence = ['E-NOPE']; }).some(e => /unknown evidence/.test(e)));
  assert.ok(files(c => { c.rules.pgx.rules[0].evidence = []; }).some(e => /cites no evidence/.test(e)));
  assert.ok(files(c => { c.rules.pgx.rules[0].condition.phenotypeIn = ['bogus']; }).some(e => /not defined/.test(e)));
  assert.ok(files(c => { c.rules.pgx.rules[0].drug = 'nodrug'; }).some(e => /unknown drug/.test(e)));
  assert.ok(files(c => { c.drugs.drugs.push({ ...c.drugs.drugs[0] }); }).some(e => /duplicate drug id/.test(e)));
});

// ---------------- reference cases (guideline-derived; see fixtures for sources) ----------------
for (const c of CASES) test(`reference: ${c.id} -> ${c.expected}  [${c.source}]`, () => assert.equal(cat(c.patient, c.drug), c.expected));

// ---------------- missing / unknown genotype handling ----------------
test('missing genotype is never read as normal: default patient -> no drug with verified rules is no_flag', () => {
  const a = run({});
  for (const r of a.results) if (r.coverage.totalRules > 0) assert.notEqual(r.overall.category, 'no_flag', r.drugId);
});
for (const st of ['not_tested', 'unknown', 'indeterminate', 'conflicting'])
  test(`genotype state ${st} -> needs_info, not no_flag`, () => {
    const raw = { ...base(), genotypes: { 'HLA-B*57:01': { status: st } } };
    const r = drug(run(raw), 'abacavir');
    assert.equal(r.overall.category, 'needs_info'); assert.ok(r.missingInfo.some(m => m.field === 'genotype.HLA-B*57:01' && m.blocking));
  });
test('result_available without a phenotype is a validation error and is not treated as normal', () => {
  const a = run({ ...base(), genotypes: { 'HLA-B*57:01': { status: 'result_available' } } });
  assert.ok(a.validation.errors.some(e => e.field === 'genotype.HLA-B*57:01'));
  assert.equal(drug(a, 'abacavir').overall.category, 'needs_info');
});
test('phenotype not valid for the gene is rejected', () => {
  const a = run({ ...base(), genotypes: { 'HLA-B*57:01': { status: 'result_available', phenotype: 'poor' } } });
  assert.ok(a.validation.errors.length); assert.equal(drug(a, 'abacavir').overall.category, 'needs_info');
});

// ---------------- precedence / safety overrides ----------------
test('multiple simultaneous findings are ALL preserved; strongest wins', () => {
  const r = drug(run(base({ age: 8 }, { CYP2D6: 'ultrarapid' })), 'codeine');
  assert.equal(r.overall.category, 'avoid');
  const ids = r.findings.map(f => f.ruleId);
  assert.ok(ids.includes('R-PGX-CODEINE-CYP2D6-UM') && ids.includes('R-AGE-CODEINE-LT12'));
});
test('safety override: an avoid finding is never downgraded by other inputs', () => {
  const raw = base({ age: 30, egfrValue: '120', allergyHistoryStatus: 'none_known' }, { 'HLA-B*57:01': 'positive' });
  assert.equal(cat(raw, 'abacavir'), 'avoid');
});
test('precedence order is avoid > modify > conditional > monitor > needs_info > informational > no_flag', () => {
  assert.deepEqual([...CATEGORIES].sort((a, b) => PRECEDENCE[b] - PRECEDENCE[a]), ['avoid', 'modify', 'conditional', 'monitor', 'needs_info', 'informational', 'no_flag']);
});
test('no numeric safety score exists anywhere in results', () => {
  const s = JSON.stringify(run(base({}, { 'HLA-B*57:01': 'positive' })).results);
  assert.doesNotMatch(s, /score|confidence/i);
});
test('conditional finding records the category it would become', () => {
  const f = drug(run(base({}, { CYP2C19: 'poor' })), 'clopidogrel').findings[0];
  assert.equal(f.category, 'conditional'); assert.equal(f.conditionalOn, 'modify');
});
test('blocking missing input outranks informational but not a real finding', () => {
  const r = drug(run({ ...base({ age: 8 }), genotypes: {} }), 'codeine'); // gene untested, age 8 -> avoid by age
  assert.equal(r.overall.category, 'avoid'); assert.ok(r.missingInfo.some(m => m.blocking));
});

// ---------------- age / breastfeeding / renal ----------------
test('age missing -> codeine needs_info (age rule not evaluable)', () => assert.equal(cat(base({ age: '' }, { CYP2D6: 'normal' }), 'codeine'), 'needs_info'));
test('breastfeeding unknown is recorded as missing info, non-blocking', () => {
  const r = drug(run(base({ breastfeeding: 'unknown' }, { CYP2D6: 'normal' })), 'codeine');
  assert.ok(r.missingInfo.some(m => m.field === 'breastfeeding' && m.blocking === false));
  assert.equal(r.overall.category, 'no_flag');
});
test('renal: stale eGFR adds a caveat; missing date adds a caveat', () => {
  const stale = drug(run(base({ egfrValue: '25', egfrDate: '2024-01-01' })), 'metformin').findings[0];
  assert.ok(stale.caveats.some(c => /older than 12 months/.test(c)));
  const nodate = drug(run(base({ egfrValue: '25', egfrDate: '' })), 'metformin').findings[0];
  assert.ok(nodate.caveats.some(c => /date is missing/.test(c)));
});
test('renal: invalid eGFR values are rejected and treated as missing', () => {
  for (const v of ['abc', '-5', '500']) { const a = run(base({ egfrValue: v })); assert.ok(a.validation.errors.some(e => e.field === 'egfrValue'), v); assert.equal(drug(a, 'metformin').overall.category, 'needs_info'); }
});
test('renal: future and malformed eGFR dates are rejected', () => {
  assert.ok(run(base({ egfrDate: '2027-01-01' })).validation.errors.some(e => e.field === 'egfrDate'));
  assert.ok(run(base({ egfrDate: '2026-02-30' })).validation.errors.some(e => e.field === 'egfrDate'));
  assert.ok(run(base({ egfrDate: 'yesterday' })).validation.errors.some(e => e.field === 'egfrDate'));
});
test('pregnancy is recorded but reported as NOT used (no verified rule)', () => {
  const a = run(base({ pregnancy: 'yes' })); assert.ok(a.inputsNotUsed.some(u => u.field === 'pregnancy'));
});

// ---------------- allergy ----------------
const allergy = (status, cls = 'penicillin', extra = {}) => base({ allergyHistoryStatus: 'recorded', allergies: [{ substanceClass: cls, status, reaction: 'rash', severity: 'moderate', ...extra }] });
test('allergy: history not assessed -> needs_info (absence is not "no allergy")', () => assert.equal(cat(base({ allergyHistoryStatus: 'not_assessed' }), 'amoxicillin'), 'needs_info'));
test('allergy: none known (assessed) -> no_flag', () => assert.equal(cat(base(), 'amoxicillin'), 'no_flag'));
test('allergy: documented same-class -> avoid; suspected -> conditional; intolerance -> informational; unknown -> conditional', () => {
  assert.equal(cat(allergy('documented'), 'amoxicillin'), 'avoid');
  assert.equal(cat(allergy('suspected'), 'amoxicillin'), 'conditional');
  assert.equal(cat(allergy('intolerance'), 'amoxicillin'), 'informational');
  assert.equal(cat(allergy('unknown'), 'amoxicillin'), 'conditional');
});
test('allergy: cross-reactivity is NOT overgeneralised (documented penicillin allergy -> cephalexin is review, not avoid)', () => {
  assert.equal(cat(allergy('documented'), 'cephalexin'), 'conditional');
  assert.equal(cat(allergy('suspected'), 'cephalexin'), 'informational');
});
test('allergy: different class does not affect the drug', () => { assert.equal(cat(allergy('documented', 'sulfonamide_antibiotic'), 'amoxicillin'), 'no_flag'); });
test('allergy: NSAID class applies to ibuprofen and aspirin', () => { for (const d of ['ibuprofen', 'aspirin']) assert.equal(cat(allergy('documented', 'nsaid'), d), 'avoid'); });
test('allergy: rules are labelled citation-pending, never presented as guideline-verified', () => {
  const f = drug(run(allergy('documented')), 'amoxicillin').findings[0]; assert.equal(f.status, 'citation_pending'); assert.equal(f.evidence.length, 0);
});
test('allergy: entry detail (reaction/severity/date/source/confidence) is carried into the trigger', () => {
  const f = drug(run(allergy('documented', 'penicillin', { date: '2020-05-01', source: 'GP record', confidence: 'high' })), 'amoxicillin').findings[0];
  assert.match(f.triggers[0].value, /rash/); assert.match(f.triggers[0].value, /2020-05-01/); assert.match(f.triggers[0].value, /GP record/);
});

// ---------------- interactions ----------------
test('interactions: not configured -> notice raised and NO interaction findings or "safe" claim', () => {
  const a = run(base({ currentMedications: ['warfarin', 'aspirin'] }));
  assert.ok(a.notices.some(n => n.type === 'interaction_not_configured'));
  for (const r of a.results) assert.ok(!r.findings.some(f => f.module === 'interaction'));
});
test('interactions: configured TEST-ONLY dataset is matched by ingredient id (not substring)', () => {
  const clone = JSON.parse(JSON.stringify({ meta: ds.meta, genes: ds.genes, vocab: ds.vocab, evidence: { evidence: ds.evidence }, drugs: { drugs: ds.drugs },
    unverified: { associations: [] }, rules: { pgx: { rules: [] }, allergy: { rules: [] }, renal: { rules: [] }, age_context: { rules: [] } },
    interactions: { status: 'configured', pairs: [{ a: 'warfarin', b: 'aspirin', severity: 'major', effect: 'TEST FIXTURE ONLY', mechanism: 'test', management: 'test', evidence: [], status: 'verified' }] } }));
  const d2 = buildDataset(clone);
  const a = run(base({ currentMedications: ['Coumadin 5mg'] }), d2);
  assert.equal(drug(a, 'aspirin').findings.find(f => f.module === 'interaction').category, 'modify');
  assert.ok(!a.notices.some(n => n.type === 'interaction_not_configured'));
  assert.ok(!drug(run(base({ currentMedications: ['aspirinase'] }), d2), 'warfarin').findings.some(f => f.module === 'interaction'));
});

// ---------------- medications / duplicates ----------------
test('medication normalisation: brand names, doses and punctuation resolve to ingredients', () => {
  const p = normalizePatient({ currentMedications: ['Coumadin 5 mg tablets', 'PLAVIX', 'lisinopril 10mg'] }, ds, NOW);
  assert.deepEqual(p.currentMedications.map(m => m.ingredientId), ['warfarin', 'clopidogrel', null]);
});
test('duplicate: same ingredient listed twice raises a notice; candidate already prescribed gets an informational finding', () => {
  const a = run(base({ currentMedications: ['warfarin', 'Coumadin'] }));
  assert.ok(a.notices.some(n => n.type === 'duplicate_ingredient'));
  assert.ok(drug(a, 'warfarin').findings.some(f => f.ruleId === 'ENGINE-DUP-001'));
});
test('unrecognised medications are reported, not silently ignored', () => {
  assert.ok(run(base({ currentMedications: ['mysterydrug'] })).notices.some(n => n.type === 'unrecognised_medication'));
});

// ---------------- unverified coverage ----------------
test('drugs with only unverified associations are NEVER no_flag and never avoid/modify', () => {
  for (const id of ['phenytoin', 'warfarin', 'tamoxifen', 'omeprazole', 'rosuvastatin']) {
    const raw = base({}, { CYP2C9: 'poor', VKORC1: 'variant_present', CYP2D6: 'poor', CYP2C19: 'poor', SLCO1B1: 'poor' });
    const r = drug(run(raw), id);
    assert.equal(r.overall.category, 'informational', id); assert.equal(r.coverage.verifiedRules, 0);
    assert.ok(r.findings.every(f => f.status === 'unverified'), id);
  }
});
test('drug with no rules at all is "not assessed", not safe', () => {
  const r = drug(run(base()), 'levothyroxine'); assert.equal(r.overall.category, 'informational'); assert.match(r.summary, /NOT been assessed/);
});
test('no_flag wording never claims safety', () => {
  const r = drug(run(base({}, { 'HLA-B*57:01': 'negative' })), 'abacavir'); assert.equal(r.overall.category, 'no_flag'); assert.match(r.summary, /does not establish/);
  assert.doesNotMatch(r.summary + r.overall.label, /\bsafe\b/i);
});

// ---------------- invalid / malformed input ----------------
test('malformed input never throws', () => {
  for (const raw of [undefined, null, {}, { age: 'abc' }, { age: -1 }, { age: 999 }, { genotypes: null }, { currentMedications: [null, 5, {}] }, { allergies: [{ substanceClass: 'x' }] }, { genotypes: { FOO: { status: 'result_available' } } }])
    assert.doesNotThrow(() => run(raw ?? {}), JSON.stringify(raw));
});
test('invalid age rejected and treated as missing', () => { for (const v of ['abc', -1, 999]) { const a = run(base({ age: v })); assert.ok(a.validation.errors.some(e => e.field === 'age')); assert.equal(a.patient.age, null); } });
test('unknown allergy class and bad dates produce errors', () => {
  assert.ok(run(base({ allergies: [{ substanceClass: 'bogus', status: 'documented' }] })).validation.errors.length);
  assert.ok(run(base({ allergies: [{ substanceClass: 'penicillin', status: 'documented', date: '31/12/2020' }] })).validation.errors.length);
});
test('hostile strings stay inert data (pseudonym truncated; no evaluation of content)', () => {
  const a = run({ ...base(), pseudonym: '<img src=x onerror=alert(1)>'.repeat(10), currentMedications: ['<script>alert(1)</script>'] });
  assert.ok(a.patient.pseudonym.length <= 40); assert.equal(a.patient.currentMedications[0].recognised, false);
});

// ---------------- determinism & invariants (property test) ----------------
function rng(seed) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
function randomPatient(r) {
  const pick = (a) => a[Math.floor(r() * a.length)];
  const genotypes = {};
  for (const g of ds.genes.genes) { const st = pick(['not_tested', 'unknown', 'indeterminate', 'conflicting', 'result_available', 'result_available']); genotypes[g.id] = st === 'result_available' ? { status: st, phenotype: pick(g.phenotypes) } : { status: st }; }
  return { age: pick(['', 3, 11, 12, 17, 18, 45, 80, 130, 'x']), pregnancy: pick(['yes', 'no', 'unknown']), breastfeeding: pick(['yes', 'no', 'unknown', 'not_applicable']),
    egfrValue: pick(['', 10, 29, 30, 44, 45, 90, 'bad']), egfrDate: pick(['', '2026-09-01', '2020-01-01']), indication: pick(['unknown', 'acs_pci', 'other_antiplatelet', 'other']),
    allergyHistoryStatus: pick(['not_assessed', 'none_known', 'recorded']), allergies: r() < 0.5 ? [{ substanceClass: pick(['penicillin', 'nsaid', 'sulfonamide_antibiotic']), status: pick(['documented', 'suspected', 'intolerance', 'unknown']) }] : [],
    currentMedications: r() < 0.5 ? [pick(['warfarin', 'metformin 500mg', 'Plavix', 'codeine', 'xyz'])] : [], priorExposure: { carbamazepine: pick(['naive', 'prior', 'unknown']), oxcarbazepine: pick(['naive', 'prior', 'unknown']), metformin: pick(['naive', 'prior', 'unknown']) }, genotypes };
}
test('property: 3000 random patients satisfy all safety invariants', () => {
  const r = rng(12345);
  for (let i = 0; i < 3000; i++) {
    const a = run(randomPatient(r));
    for (const d of a.results) {
      const worst = d.findings.reduce((m, f) => Math.max(m, PRECEDENCE[f.category]), 0);
      assert.ok(PRECEDENCE[d.overall.category] >= worst, `overall below worst finding: ${d.drugId}`);
      if (d.findings.some(f => f.category === 'avoid')) assert.equal(d.overall.category, 'avoid');
      if (d.overall.category === 'no_flag') { assert.equal(d.findings.length, 0); assert.ok(d.coverage.totalRules > 0); assert.ok(!d.missingInfo.some(m => m.blocking)); }
      if (d.missingInfo.some(m => m.blocking) && d.findings.length === 0) assert.equal(d.overall.category, 'needs_info');
      assert.ok(d.timestamp && d.ruleSetVersion);
      for (const f of d.findings) { assert.ok(ds.ruleById.has(f.ruleId) || /^(UNVERIFIED|ENGINE|INT)-/.test(f.ruleId), f.ruleId); if (f.status === 'verified' || f.status === 'verified_secondary') assert.ok(f.evidence.length > 0); }
    }
  }
});
test('determinism: identical input -> identical output', () => { const p = randomPatient(rng(7)); assert.deepEqual(run(p), run(p)); });

// ---------------- report / CSV ----------------
test('CSV: one row per finding (or per drug without findings) + header; consistent with on-screen results', () => {
  const a = run(base({ age: 8 }, { CYP2D6: 'ultrarapid', 'HLA-B*57:01': 'positive' }));
  const rows = reportToCsv(a).trim().split('\r\n');
  const expected = 1 + a.results.reduce((n, r) => n + Math.max(1, r.findings.length), 0);
  assert.equal(rows.length, expected);
  for (const r of a.results) assert.ok(reportToCsv(a).includes(`"${r.overall.label}"`));
});
test('CSV: formula injection is neutralised and quotes escaped', () => {
  const a = run(base()); a.results[0].name = '=HYPERLINK("http://evil","x")'; a.results[1].name = '@SUM(1)';
  const csv = reportToCsv(a); assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""x"")"`)); assert.ok(csv.includes(`"'@SUM(1)"`));
});
test('report model: includes version, date, disclaimer, completeness and every drug exactly once', () => {
  const rep = buildReport(run(base()));
  assert.ok(rep.ruleSetVersion && rep.generatedAt && /not for prescribing/i.test(rep.disclaimer)); assert.ok(rep.completeness.total > 0);
  assert.equal(rep.groups.reduce((n, g) => n + g.drugs.length, 0), ds.drugs.length);
});
test('report omits unnecessary personal data (no name, sex, weight, height fields exist)', () => {
  const s = JSON.stringify(buildReport(run(base()))); for (const k of ['"name":"John', 'weight', 'height', 'sex']) assert.ok(!s.includes(k), k);
});
test('evidence traceability: every avoid/modify finding resolves to a rule with source metadata', () => {
  const a = run(base({ age: 8, indication: 'acs_pci' }, { CYP2D6: 'ultrarapid', 'HLA-B*57:01': 'positive', CYP2C19: 'poor', DPYD: 'poor', SLCO1B1: 'poor', TPMT: 'poor' }));
  for (const d of a.results) for (const f of d.findings) if (['avoid', 'modify'].includes(f.category)) { assert.ok(ds.ruleById.has(f.ruleId)); assert.ok(f.evidence.length >= 1 && f.evidence.every(e => e.url && e.year)); }
});
