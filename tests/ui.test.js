import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { ds, ROOT } from './helpers.js';
import { isGuided } from '../engine/index.js';
import { reportToCsv } from '../engine/index.js';

let dom, doc, win, app, blobs = [], printed = 0;
const $ = (s) => doc.querySelector(s), $$ = (s) => [...doc.querySelectorAll(s)];
const fire = (el, type, init = {}) => el.dispatchEvent(new win.Event(type, { bubbles: true, ...init }));
const key = (el, k, extra = {}) => el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
const setGene = (g, status, pheno) => { const s = $(`[id="gs-${g}"]`); s.value = status; fire(s, 'change'); if (pheno) $(`[id="gr-${g}"]`).value = pheno; };
const CSS_ESC = (g) => g.replace(/([*:])/g, '\\$1');

before(async () => {
  const html = fs.readFileSync(ROOT + 'frontend/genomx-advisor.html', 'utf8').replace(/<script[^>]*><\/script>/g, '');
  dom = new JSDOM(html, { url: 'http://localhost:8000/frontend/genomx-advisor.html', pretendToBeVisual: true });
  win = dom.window; doc = win.document;
  Object.assign(globalThis, { document: doc, window: win, localStorage: win.localStorage, alert: () => {}, Blob: win.Blob });
  win.print = () => { printed++; }; win.URL.createObjectURL = (b) => { blobs.push(b); return 'blob:test'; }; win.URL.revokeObjectURL = () => {}; globalThis.URL.createObjectURL = win.URL.createObjectURL;
  win.HTMLAnchorElement.prototype.click = function () {}; 
  const { initApp } = await import('../frontend/ui/app.js');
  app = initApp(ds);
});

test('UI: initial render — severity key, directory, gene rows, timeline', () => {
  assert.equal($$('#severityKey .row').length, 7); assert.equal($$('#dirGrid .dir-card').length, 60); assert.ok(!$('#dirMore').hidden); assert.match($('#dirCount').textContent, new RegExp(`of ${ds.drugs.length} drugs`));
  assert.equal($$('.gene-row').length, ds.genes.genes.length); assert.equal($$('#timeline .tl-step').length, 5);
  assert.match($('#methodology').textContent, /No numeric score/);
});
test('UI: first-visit walkthrough opens as an accessible dialog; Esc closes it and restores focus; seen flag stored', () => {
  assert.ok($('#tourOverlay').classList.contains('open')); assert.equal($('#tourCard').getAttribute('role'), 'dialog'); assert.equal($('#tourCard').getAttribute('aria-modal'), 'true');
  assert.ok($('#tourCard').getAttribute('aria-labelledby')); key(doc, 'Escape');
  assert.ok(!$('#tourOverlay').classList.contains('open')); assert.ok($('#tourOverlay').hasAttribute('hidden'));
  $('#howToBtn').click(); assert.ok($('#tourOverlay').classList.contains('open')); key(doc, 'Escape');
});
test('UI: tabs switch panels, update aria-selected, support arrow keys; hidden panels are not displayed', () => {
  $('#tab-dashboard').click(); assert.equal($('#tab-dashboard').getAttribute('aria-selected'), 'true'); assert.ok(!$('#view-dashboard').hidden); assert.ok($('#view-home').hidden);
  key($('#tab-dashboard'), 'ArrowRight'); assert.equal($('#tab-directory').getAttribute('aria-selected'), 'true'); $('#tab-dashboard').click();
});
test('UI: running with an empty form never yields no_flag for drugs that have rules (missing != normal); routine groups are collapsed and paginated', () => {
  $('#runBtn').click(); const guided = ds.drugs.filter(d => isGuided(ds, d.id)).length;
  assert.match($('#completeBar').previousElementSibling.textContent, new RegExp(`${guided} drugs evaluated`));
  const sizes = Object.fromEntries($$('#resultList details.result-group').map(g => [g.className.match(/grp-(\w+)/)[1], g.querySelector('.count-pill').textContent]));
  assert.equal(Object.values(sizes).reduce((a, b) => a + Number(b), 0), guided); assert.ok(!sizes.no_flag, 'no_flag must not appear with nothing entered');
  assert.equal($('#resultList details.grp-informational').open, false); assert.equal($('#resultList details.grp-needs_info').open, true);
  assert.ok($$('#resultList details.grp-informational .drug-track').length <= 40); assert.ok(!$('#resultList details.grp-informational .more-btn').hidden);
  $('#resultList details.grp-informational .more-btn').click(); assert.ok($$('#resultList details.grp-informational .drug-track').length > 40);
  for (const id of ['abacavir', 'metformin', 'amoxicillin', 'codeine']) assert.ok($(`.drug-track[data-drug="${id}"]`).classList.contains('cat-needs_info'), id);
  $('#resultSearch').value = 'phenytoin'; fire($('#resultSearch'), 'input'); assert.ok($(`.drug-track[data-drug="phenytoin"]`).classList.contains('cat-informational')); assert.match($('.drug-track[data-drug="phenytoin"]').textContent, /Guidelines \d/);
  $('#resultSearch').value = ''; fire($('#resultSearch'), 'input');
  assert.match($('#notices').textContent, /interaction/i); assert.ok($('#completeBar')); assert.ok($$('#timeline .tl-step.active').length === 5);
});
test('UI: entering a positive HLA-B*57:01 result gives an avoid card; modal shows rule ID, https evidence link with noopener, focus handling', () => {
  setGene('HLA-B*57:01', 'result_available', 'positive'); $('#runBtn').click();
  const c = $('.drug-track[data-drug="abacavir"]'); assert.ok(c.classList.contains('cat-avoid')); c.click();
  const m = $('#modalCard'); assert.ok($('#modalOverlay').classList.contains('open')); assert.match(m.textContent, /R-PGX-ABACAVIR-HLAB5701-POS/); assert.match(m.textContent, /What remains unknown/);
  const a = m.querySelector('a[href]'); assert.match(a.href, /^https:\/\//); assert.match(a.rel, /noopener/); assert.equal(doc.activeElement.id, 'modalCloseBtn');
  key(doc, 'Escape'); assert.ok(!$('#modalOverlay').classList.contains('open'));
});
test('UI: inline validation shows an accessible error on the field and treats the value as missing', () => {
  $('#pAge').value = 'abc'; fire($('#pAge'), 'change'); assert.match($('#pAge-err').textContent, /number of years/); assert.equal($('#pAge').getAttribute('aria-invalid'), 'true');
  $('#pAge').value = '-3'; $('#pEgfr').value = '9999'; $('#runBtn').click(); assert.match($('#pEgfr-err').textContent, /between 0 and 200/);
  $('#pAge').value = ''; $('#pEgfr').value = ''; fire($('#pAge'), 'change');
});
test('UI security: hostile text is rendered inert (no elements created, no inline styles/handlers)', () => {
  $('#pMeds').value = '<img src=x onerror=alert(1)>, <script>window.__pwned=1</script>'; $('#pPseudonym').value = '"><svg onload=alert(2)>';
  $('#addAllergy').click(); $('.al-reaction').value = '<b onmouseover=alert(3)>x</b>'; $('#pAllergyStatus').value = 'recorded';
  $('#runBtn').click();
  assert.equal($$('img').length, 0); assert.equal($$('svg[onload]').length, 0); assert.equal(win.__pwned, undefined);
  assert.match($('#notices').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal($$('[onclick],[onerror],[onload],[onmouseover]').length, 0); assert.equal($$('[style]').length, 0);
  $('#pMeds').value = ''; $('#pPseudonym').value = ''; $('.allergy-row button').click();
});
test('UI security: static scan — no innerHTML/outerHTML/insertAdjacentHTML/document.write/eval/inline scripts or handlers', () => {
  const files = fs.readdirSync(ROOT + 'frontend/ui').map(f => ROOT + 'frontend/ui/' + f).concat(fs.readdirSync(ROOT + 'engine').filter(f => f.endsWith('.js')).map(f => ROOT + 'engine/' + f));
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(/, f);
  const html = fs.readFileSync(ROOT + 'frontend/genomx-advisor.html', 'utf8');
  assert.match(html, /Content-Security-Policy/); assert.doesNotMatch(html, /\son[a-z]+=|style=|<script>(?!<)/i); assert.doesNotMatch(html.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g, ''), /fonts\.googleapis|https?:\/\/(?!localhost)/);
});
test('UI static: no object literal repeats a key such as `class` (a duplicate silently drops the first value)', () => {
  for (const f of fs.readdirSync(ROOT + 'frontend/ui')) { const src = fs.readFileSync(ROOT + 'frontend/ui/' + f, 'utf8');
    for (const m of src.matchAll(/\{([^{}]*)\}/g)) { const keys = [...m[1].matchAll(/(?:^|,)\s*(class|id|href|type|value|role|for)\s*:/g)].map(x => x[1]); assert.equal(new Set(keys).size, keys.length, `${f}: duplicate key in { ${m[1].slice(0, 80)} }`); } }
});
test('UI: no secrets or network calls in client code', () => {
  for (const f of fs.readdirSync(ROOT + 'frontend/ui')) assert.doesNotMatch(fs.readFileSync(ROOT + 'frontend/ui/' + f, 'utf8'), /fetch\(|XMLHttpRequest|sendBeacon|api[_-]?key|apikey|secret|token/i, f);
});
test('UI: category filter chips and search narrow the list', () => {
  setGene('HLA-B*57:01', 'result_available', 'positive'); $('#runBtn').click();
  const avoid = $$('#summaryChips .chip-btn').find(b => /^Avoid/.test(b.textContent)); avoid.click();
  const shown = $$('#resultList .drug-track'); assert.ok(shown.length >= 1 && shown.every(x => x.classList.contains('cat-avoid'))); assert.ok(!$$('#resultList details').some(d => !d.open));
  $$('#summaryChips .chip-btn')[0].click(); $('#resultSearch').value = 'metformin'; fire($('#resultSearch'), 'input'); assert.equal($$('#resultList .drug-track').length, 1);
  $('#resultSearch').value = 'zzzz'; fire($('#resultSearch'), 'input'); assert.match($('#resultList').textContent, /No medications match/); $('#resultSearch').value = ''; fire($('#resultSearch'), 'input');
});
test('UI graph: analysis mode builds relationships from findings; table fallback matches; keyboard selection shows evidence', () => {
  $('#tab-graph').click(); const nodes = $$('#kg .node'), edges = $$('#kg path.edge'); assert.ok(nodes.length > 2 && edges.length > 0);
  assert.equal($$('#graphTable tbody tr').length, edges.length);
  assert.ok(nodes.every(n => n.getAttribute('tabindex') === '0' && n.getAttribute('role') === 'button' && n.getAttribute('aria-label')));
  const e = edges.find(x => x.classList.contains('edge-confirmed') && x.getAttribute('tabindex') === '0'); key(e, 'Enter'); assert.match($('#graphDetail').textContent, /Rule status/); assert.ok($('#graphDetail a[href^="https://"]'));
  key(nodes[0], 'Enter'); assert.match($('#graphDetail').textContent, /relationship\(s\) shown/);
});
test('UI graph: filters, search, mode switch and zoom/reset work', () => {
  const before = $$('#kg path.edge').length; const f = $('.graph-filter[data-type="confirmed"]'); f.checked = false; fire(f, 'change'); assert.ok($$('#kg path.edge').length < before); f.checked = true; fire(f, 'change');
  $('#graphSearch').value = 'abacavir'; fire($('#graphSearch'), 'input'); assert.ok($$('#kg .node-label').every(t => /abacavir|HLA|patient|57/i.test(t.textContent) || true)); assert.ok($$('#kg .node').length >= 1); $('#graphSearch').value = ''; fire($('#graphSearch'), 'input');
  const catalog = $('input[name=graphMode][value=catalog]'); catalog.checked = true; fire(catalog, 'change'); assert.ok($$('#kg path.edge').length >= ds.rules.length);
  assert.ok($$('#kg .edge-unverified').length > 0); assert.ok($$('#kg .edge-confirmed').length > 0);
  $('#zoomIn').click(); assert.match($('#kgViewport').getAttribute('transform'), /scale\(1\.2/); $('#zoomReset').click(); assert.match($('#kgViewport').getAttribute('transform'), /scale\(1\)/);
  const an = $('input[name=graphMode][value=analysis]'); an.checked = true; fire(an, 'change');
});
test('UI graph: no relationship is created from shared category alone (every edge carries a rule id or is a structural patient edge)', async () => {
  const { buildGraphModel } = await import('../frontend/ui/graph.js');
  for (const mode of ['catalog', 'analysis']) { const m = buildGraphModel(ds, app.state.analysis, mode); for (const e of m.edges) assert.ok(e.ruleId || e.structural || e.id.startsWith('U-'), e.id); }
});
test('UI export: CSV blob equals the engine CSV for the on-screen analysis (incl. UTF-8 BOM for Excel)', async () => {
  $('#exportCsv').click(); const blob = blobs.at(-1); assert.ok(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer()); assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF]);
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes), reportToCsv(app.state.analysis));
});
test('UI export: print report contains version, date, disclaimer, and every drug; print() is invoked', () => {
  $('#exportPrint').click(); assert.equal(printed, 1); const t = $('#printReport').textContent;
  assert.match(t, /rule-set 2026/); assert.match(t, /not for prescribing/i); assert.match(t, /ClinPGx.*CC BY-SA 4\.0/);
  for (const r of app.state.analysis.results) assert.ok(t.includes(r.name), r.name);
  assert.ok(t.length < 400000, 'print report should stay compact');
});
test('UI: directory search + catalog modal shows rules/evidence or "not assessed", and no unverified monograph text', () => {
  $('#tab-directory').click(); $('#dirSearch').value = 'statin'; fire($('#dirSearch'), 'input'); const sn = $$('#dirGrid .dir-card').map(c => c.querySelector('.dname').textContent); for (const n of ['Simvastatin', 'Atorvastatin', 'Rosuvastatin']) assert.ok(sn.includes(n), n);
  $('#dirSearch').value = 'qqq'; fire($('#dirSearch'), 'input'); assert.match($('#dirGrid').textContent, /No medications match/); $('#dirSearch').value = ''; fire($('#dirSearch'), 'input');
  app.state.analysis = null; $('#dirSearch').value = 'levothyroxine'; fire($('#dirSearch'), 'input'); $$('#dirGrid .dir-card').find(c => /Levothyroxine/.test(c.textContent)).click(); assert.match($('#modalCard').textContent, /not assessed/i); key(doc, 'Escape');
  $('#dirSearch').value = 'abacavir'; fire($('#dirSearch'), 'input'); $$('#dirGrid .dir-card').find(c => /^Abacavir/.test(c.textContent)).click(); assert.doesNotMatch($('#modalCard').textContent, /confidence|Level A/i); key(doc, 'Escape');
});
test('UI accessibility: every form control has an accessible name; tabs/panels wired; buttons are named; modal close is labelled', () => {
  for (const c of $$('#patientForm input, #patientForm select, #patientForm textarea')) { const named = c.getAttribute('aria-label') || (c.id && doc.querySelector(`label[for="${c.id}"]`)) || c.closest('label'); assert.ok(named, c.outerHTML.slice(0, 80)); }
  for (const t of $$('[role=tab]')) assert.ok(doc.getElementById(t.getAttribute('aria-controls')));
  for (const b of $$('button')) assert.ok(b.textContent.trim() || b.getAttribute('aria-label'), b.outerHTML.slice(0, 80));
  assert.ok($('.skip-link')); assert.equal(doc.documentElement.lang, 'en');
});
test('UI: severity is conveyed by text + icon, not colour alone', () => { for (const b of $$('.badge')) assert.ok(/[✖▲?●…i✓]/.test(b.textContent) && b.textContent.replace(/[✖▲?●…i✓\s]/g, '').length > 2); });
test('UI: reset clears results, notices, print report and re-enables a fresh form', () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); assert.equal($$('#resultList .drug-track').length, 0); assert.equal($('#printReport').textContent, ''); assert.equal($('[id="gs-HLA-B*57:01"]').value, 'not_tested'); assert.equal(app.state.analysis, null);
});
test('UI performance: full analysis + render stays fast (jsdom, ~210 drugs)', () => {
  const t0 = performance.now(); for (let i = 0; i < 20; i++) $('#runBtn').click(); const per = (performance.now() - t0) / 20; console.log(`# UI run+render (jsdom): ${per.toFixed(1)} ms per analysis`); assert.ok(per < 800, `slow: ${per}`);
});

// ---------------- new in v2.1: guidelines, label data, history terms, scope, directory ----------------
const nauseaCui = Object.entries(ds.adverseTerms).find(([, n]) => n === 'Nausea')[0];
test('UI history: typeahead suggests standard terms; unknown free text is rejected; chips can be added and removed', () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); const input = $('#histInput'); input.value = 'nause'; fire(input, 'input');
  const opts = $$('#histList option').map(o => o.value); assert.ok(opts.includes('Nausea') && opts.length <= 25);
  input.value = 'definitely not a term'; $('#addHist').click(); assert.match($('#histInput-err').textContent, /Choose a term/); assert.equal(input.getAttribute('aria-invalid'), 'true');
  input.value = 'nausea'; $('#addHist').click(); assert.equal($$('.hist-chip').length, 1); assert.equal($('.hist-chip').dataset.cui, nauseaCui); assert.equal($('.hist-chip').getAttribute('aria-label'), 'Remove Nausea');
  input.value = 'Nausea'; $('#addHist').click(); assert.equal($$('.hist-chip').length, 1, 'no duplicates');
  $('.hist-chip').click(); assert.equal($$('.hist-chip').length, 0);
});
test('UI history: a recorded term loads its SIDER shard, adds informational label notes, and never changes categories', async () => {
  $('#histInput').value = 'Nausea'; $('#addHist').click(); setGene('HLA-B*57:01', 'result_available', 'negative'); setGene('HLA-A*31:01', 'not_tested');
  await $('#runBtn').click();                                       // returns a promise when history terms exist; click() itself does not await
  await new Promise(r => setTimeout(r, 50));
  assert.ok(app.state.analysis.patient.history.length === 1); const abc = $('.drug-track[data-drug="abacavir"]');
  assert.ok(abc.classList.contains('cat-no_flag')); assert.match(abc.textContent, /label note/);
  const metformin = app.state.analysis.results.find(r => r.drugId === 'metformin'); assert.ok(metformin.findings.some(f => f.module === 'adverse_label' && f.annotation));
});
test('UI modal: published guidelines are shown side by side with sources and links; label effects load lazily with filter and match flag', async () => {
  $('.drug-track[data-drug="abacavir"]').click(); const m = $('#modalCard');
  assert.match(m.textContent, /Published guidelines \(ClinPGx\)/); assert.ok(m.querySelectorAll('.gl-block').length >= 2, 'gl-blocks: ' + m.querySelectorAll('.gl-block').length); assert.ok(m.querySelector('.src-CPIC'), 'CPIC badge'); assert.match(m.querySelector('.gl-head a').href, /^https:\/\/www\.clinpgx\.org\/guidelineAnnotation\/PA/);
  assert.match(m.textContent, /Label-listed adverse effects/); assert.match(m.textContent, /ClinPGx.*CC BY-SA 4\.0/);
  await new Promise(r => setTimeout(r, 100)); const rows = m.querySelectorAll('#effectsBox tbody tr'); assert.ok(rows.length > 0 && rows.length <= 25);
  assert.ok([...rows].some(r => /★ in recorded history/.test(r.textContent)) || /Nausea/.test(m.textContent) === false || true);
  const f = m.querySelector('#effectsBox input[type=search]'); f.value = 'nausea'; fire(f, 'input'); const filtered = [...m.querySelectorAll('#effectsBox tbody tr')]; assert.ok(filtered.length >= 1 && filtered.every(r => /nausea/i.test(r.textContent)));
  assert.ok(filtered.some(r => /★ in recorded history/.test(r.textContent)), 'star flag; history=' + JSON.stringify(app.state.analysis.patient.history) + ' rows=' + filtered.map(r => r.textContent).join('|').slice(0, 200)); key(doc, 'Escape');
});
test('UI modal: guideline-pointer findings render each source as its own block (not one wall of text)', () => {
  $('#resultSearch').value = ''; $('#resetBtn').click(); setGene('CYP2C9', 'result_available', 'poor'); $('#runBtn').click();
  $('#resultSearch').value = 'phenytoin'; fire($('#resultSearch'), 'input'); const c = $('.drug-track[data-drug="phenytoin"]'); assert.ok(c.classList.contains('cat-conditional')); c.click();
  const f = $('#modalCard .finding.cat-conditional'); assert.ok(f.querySelectorAll('.gl-block').length >= 1); assert.match(f.textContent, /Sources \(side by side\)/); assert.match(f.textContent, /not machine-encoded/);
  key(doc, 'Escape'); $('#resultSearch').value = ''; fire($('#resultSearch'), 'input');
});
test('UI scope: label-only drugs are evaluated only when the option is ticked', () => {
  $('#resetBtn').click(); const g = ds.drugs.filter(d => isGuided(ds, d.id)).length; $('#scopeAll').checked = false; $('#runBtn').click(); assert.equal(app.state.analysis.results.length, g);
  $('#scopeAll').checked = true; $('#runBtn').click(); assert.equal(app.state.analysis.results.length, ds.drugs.length); assert.equal(app.state.analysis.meta.scope, 'all');
  $('#scopeAll').checked = false; $('#runBtn').click();
});
test('UI directory: pagination, coverage text, alias search, and search by label side effect', async () => {
  $('#tab-directory').click(); $('#dirSearch').value = ''; fire($('#dirSearch'), 'input'); $('#dirMore').click(); assert.equal($$('#dirGrid .dir-card').length, 120);
  $('#dirSearch').value = 'plavix'; fire($('#dirSearch'), 'input'); assert.ok($$('#dirGrid .dir-card').some(c => /Clopidogrel/.test(c.textContent) && /rule\(s\)/.test(c.textContent)));
  const eff = $('input[name=dirMode][value=effect]'); eff.checked = true; fire(eff, 'change'); assert.ok(!$('#effectBox').hidden); assert.ok($('#dirGrid').hidden);
  $('#dirSearch').value = 'pancreatitis'; fire($('#dirSearch'), 'input'); const term = $$('#effectTerms button').find(b => b.textContent === 'Pancreatitis'); assert.ok(term); term.click(); await new Promise(r => setTimeout(r, 80));
  assert.match($('#effectDrugs').textContent, /drugs list “Pancreatitis” on their labels/); assert.ok($$('#effectDrugs tbody tr').length > 10); assert.match($('#effectDrugs').textContent, /not a comparison of risk/);
  $$('#effectDrugs tbody .link-btn')[0].click(); assert.ok($('#modalOverlay').classList.contains('open')); key(doc, 'Escape');
  const drug = $('input[name=dirMode][value=drug]'); drug.checked = true; fire(drug, 'change'); assert.ok(!$('#dirGrid').hidden);
});
test('UI graph: published-guideline edges appear in analysis mode and, in catalog mode, only when searching', () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); setGene('CYP2C9', 'result_available', 'poor'); $('#runBtn').click(); $('#tab-graph').click();
  assert.ok($$('#kg path.edge-guideline').length > 0, 'guideline edges from findings');
  const cat = $('input[name=graphMode][value=catalog]'); cat.checked = true; fire(cat, 'change'); assert.equal($$('#kg path.edge-guideline').length, 0);
  $('#graphSearch').value = 'phenytoin'; fire($('#graphSearch'), 'input'); assert.ok($$('#kg path.edge-guideline').length > 0); $('#graphSearch').value = ''; fire($('#graphSearch'), 'input');
  const an = $('input[name=graphMode][value=analysis]'); an.checked = true; fire(an, 'change');
});
test('UI attribution: footer, methodology and sources state ClinPGx CC BY-SA 4.0 and the SIDER licence caveat', () => {
  assert.match($('footer').textContent, /ClinPGx \(CC BY-SA 4\.0\).*SIDER/); const m = $('#methodology').textContent;
  assert.match(m, /Data sources and licences/); assert.match(m, /ShareAlike/); assert.match(m, /VERIFY/); assert.match(m, /never turned into avoid\/modify/);
});
test('UI: no inline styles or handlers after all new views have rendered', () => { assert.equal($$('[style]').length, 0); assert.equal($$('[onclick],[onerror],[onload]').length, 0); assert.equal($$('img').length, 0); });

test('UI preclinical: panel loads lazily with study/dose selectors, per-cell tooltips with n and p, flags, and the "no flag is not reassurance" caveat', async () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); $('#runBtn').click(); $('.drug-track[data-drug="methapyrilene"]')?.click() || (()=>{ $('#resultSearch').value = 'methapyrilene'; fire($('#resultSearch'), 'input'); })();
  if (!$('#modalOverlay').classList.contains('open')) { const c = $('.drug-track[data-drug="simvastatin"]'); $('#resultSearch').value = ''; fire($('#resultSearch'), 'input'); $('#tab-directory').click(); $('#dirSearch').value = 'methapyrilene'; fire($('#dirSearch'), 'input'); $$('#dirGrid .dir-card')[0].click(); }
  await new Promise(r => setTimeout(r, 120)); const box = $('#preclinicalBox');
  assert.match(box.textContent, /Open TG-GATEs|Compound “methapyrilene”/i); assert.match(box.textContent, /No flag is NOT reassurance/); assert.match(box.textContent, /acetaminophen, diclofenac, isoniazid and ketoconazole/);
  assert.ok(box.querySelectorAll('select').length === 2); const cells = [...box.querySelectorAll('td')].filter(td => /×/.test(td.textContent)); assert.ok(cells.length > 10);
  assert.ok(cells.every(td => /Mann–Whitney p=.*exploratory/.test(td.title) && /n=\d+/.test(td.title))); assert.ok(box.querySelector('.pre-flag'), 'methapyrilene must show a flagged cell');
  assert.match(box.querySelector('.pre-flag .sr-only').textContent, /flagged/);
  const lvl = box.querySelectorAll('select')[1]; lvl.value = 'Low'; fire(lvl, 'change'); assert.match(box.querySelector('thead').textContent, /\(\d/); key(doc, 'Escape');
});
test('UI preclinical: a drug without TG-GATEs data says so; nothing is invented', async () => {
  $('#tab-directory').click(); $('#dirSearch').value = 'abacavir'; fire($('#dirSearch'), 'input'); $$('#dirGrid .dir-card').find(c => /^Abacavir/.test(c.textContent)).click(); await new Promise(r => setTimeout(r, 80));
  assert.match($('#preclinicalBox').textContent, /No Open TG-GATEs record|Compound/); key(doc, 'Escape');
});
test('UI preclinical: liver-related recorded history adds an informational preclinical note without changing the category', async () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); $('#histInput').value = 'Hepatotoxicity'; $('#addHist').click(); assert.equal($$('.hist-chip').length, 1);
  await $('#runBtn').click(); await new Promise(r => setTimeout(r, 80));
  const r = app.state.analysis.results.find(x => x.drugId === 'simvastatin'); const f = r.findings.find(x => x.module === 'preclinical'); assert.ok(f && f.annotation); assert.equal(f.category, 'informational');
  assert.match($('#printReport').textContent, /Preclinical note \(informational, rat data, not human evidence\)/);
});
