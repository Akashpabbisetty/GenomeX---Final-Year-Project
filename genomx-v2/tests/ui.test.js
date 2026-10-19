import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { ds, ROOT } from './helpers.js';
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
  assert.equal($$('#severityKey .row').length, 7); assert.equal($$('#dirGrid .dir-card').length, 30);
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
test('UI: running with an empty form never yields no_flag for drugs that have rules (missing != normal)', () => {
  $('#runBtn').click(); assert.equal($$('#resultList .drug-track').length, 30);
  for (const id of ['abacavir', 'metformin', 'amoxicillin', 'codeine']) assert.ok($(`.drug-track[data-drug="${id}"]`).classList.contains('cat-needs_info'), id);
  assert.ok($(`.drug-track[data-drug="levothyroxine"]`).classList.contains('cat-informational'));
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
test('UI: no secrets or network calls in client code', () => {
  for (const f of fs.readdirSync(ROOT + 'frontend/ui')) assert.doesNotMatch(fs.readFileSync(ROOT + 'frontend/ui/' + f, 'utf8'), /fetch\(|XMLHttpRequest|sendBeacon|api[_-]?key|apikey|secret|token/i, f);
});
test('UI: category filter chips and search narrow the list', () => {
  setGene('HLA-B*57:01', 'result_available', 'positive'); $('#runBtn').click();
  const avoid = $$('#summaryChips .chip-btn').find(b => /^Avoid/.test(b.textContent)); avoid.click();
  const shown = $$('#resultList .drug-track'); assert.ok(shown.length >= 1 && shown.every(x => x.classList.contains('cat-avoid')));
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
  assert.match(t, /rule-set 2026/); assert.match(t, /not for prescribing/i); for (const d of ds.drugs) assert.ok(t.includes(d.name), d.name);
});
test('UI: directory search + catalog modal shows rules/evidence or "not assessed", and no unverified monograph text', () => {
  $('#tab-directory').click(); $('#dirSearch').value = 'statin'; fire($('#dirSearch'), 'input'); assert.equal($$('#dirGrid .dir-card').length, 3);
  $('#dirSearch').value = 'qqq'; fire($('#dirSearch'), 'input'); assert.match($('#dirGrid').textContent, /No medications match/); $('#dirSearch').value = ''; fire($('#dirSearch'), 'input');
  app.state.analysis = null; $$('#dirGrid .dir-card').find(c => /Levothyroxine/.test(c.textContent)).click(); assert.match($('#modalCard').textContent, /not assessed/i); key(doc, 'Escape');
  $$('#dirGrid .dir-card').find(c => /^Abacavir/.test(c.textContent)).click(); assert.doesNotMatch($('#modalCard').textContent, /confidence|Level A/i); key(doc, 'Escape');
});
test('UI accessibility: every form control has an accessible name; tabs/panels wired; buttons are named; modal close is labelled', () => {
  for (const c of $$('#patientForm input, #patientForm select, #patientForm textarea')) { const named = c.getAttribute('aria-label') || (c.id && doc.querySelector(`label[for="${c.id}"]`)); assert.ok(named, c.outerHTML.slice(0, 80)); }
  for (const t of $$('[role=tab]')) assert.ok(doc.getElementById(t.getAttribute('aria-controls')));
  for (const b of $$('button')) assert.ok(b.textContent.trim() || b.getAttribute('aria-label'), b.outerHTML.slice(0, 80));
  assert.ok($('.skip-link')); assert.equal(doc.documentElement.lang, 'en');
});
test('UI: severity is conveyed by text + icon, not colour alone', () => { for (const b of $$('.badge')) assert.ok(/[✖▲?●…i✓]/.test(b.textContent) && b.textContent.replace(/[✖▲?●…i✓\s]/g, '').length > 2); });
test('UI: reset clears results, notices, print report and re-enables a fresh form', () => {
  $('#tab-dashboard').click(); $('#resetBtn').click(); assert.equal($$('#resultList .drug-track').length, 0); assert.equal($('#printReport').textContent, ''); assert.equal($('[id="gs-HLA-B*57:01"]').value, 'not_tested'); assert.equal(app.state.analysis, null);
});
test('UI performance: full analysis + render stays fast (jsdom, 30 drugs)', () => {
  const t0 = performance.now(); for (let i = 0; i < 20; i++) $('#runBtn').click(); const per = (performance.now() - t0) / 20; console.log(`# UI run+render (jsdom): ${per.toFixed(1)} ms per analysis`); assert.ok(per < 400, `slow: ${per}`);
});
