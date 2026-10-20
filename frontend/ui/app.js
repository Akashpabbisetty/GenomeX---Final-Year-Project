import { h, $, $$, clear, badge, openModal, closeModal, trapTab } from './dom.js';
import { buildForm, readForm, readScope, validateLive, showErrors } from './form.js';
import { renderSummary, renderNotices, renderResults, renderDrugModal, renderCatalogModal, initTimeline, markStep, resetTimeline, renderPrintReport, ATTRIBUTION } from './results.js';
import { renderGraph } from './graph.js';
import { evaluatePatient, prepareForPatient, loadTermBuckets, fmtFreq, reportToCsv, CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT } from '../../engine/index.js';
import { renderResearchPanel } from './research-panel.js';

export function initApp(ds) {
  const S = { analysis: null, filter: 'all', query: '' };
  const form = $('#patientForm'); form.addEventListener('submit', (e) => e.preventDefault());

  // ---------- theme (only non-sensitive preference stored) ----------
  const setTheme = (m) => { document.body.setAttribute('data-theme', m); try { localStorage.setItem('genomx-theme', m); } catch { /* storage unavailable */ } $('#themeToggle').textContent = m === 'dark' ? 'Light mode' : 'Dark mode'; };
  let saved = 'light'; try { saved = localStorage.getItem('genomx-theme') || 'light'; } catch { /* ignore */ }
  setTheme(saved); $('#themeToggle').addEventListener('click', () => setTheme(document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));

  // ---------- tabs (arrow-key navigation, hidden panels not focusable) ----------
  const tabs = $$('nav.tabs button');
  const show = (view) => {
    tabs.forEach(b => { const on = b.dataset.view === view; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    $$('.view').forEach(v => { const on = v.id === 'view-' + view; v.classList.toggle('active', on); v.classList.toggle('print-active', on); v.hidden = !on; });
    if (view === 'graph') drawGraph();
  };
  tabs.forEach((b, i) => { b.addEventListener('click', () => show(b.dataset.view));
    b.addEventListener('keydown', (e) => { const n = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (n) { const t = tabs[(i + n + tabs.length) % tabs.length]; t.focus(); show(t.dataset.view); } }); });
  $('#goDashboard').addEventListener('click', () => show('dashboard'));

  // ---------- static content ----------
  const key = $('#severityKey'); CATEGORIES.forEach(c => key.append(h('div', { class: 'row' }, badge(c, CATEGORY_SHORT), h('span', { text: ' ' + CATEGORY_LABEL[c] }))));
  renderMethodology(ds, $('#methodology'));
  renderResearchPanel($('#view-about'));

  // ---------- form ----------
  buildForm(ds, form);
  const wireForm = () => {
    ['pAge', 'pEgfr', 'pEgfrDate'].forEach(id => $('#' + id, form).addEventListener('change', () => validateLive(ds, form)));
    $('#runBtn', form).addEventListener('click', run); $('#resetBtn', form).addEventListener('click', reset);
  };
  wireForm();

  // Synchronous unless history terms need their SIDER shards loaded first (then returns a Promise).
  function run() {
    resetTimeline(); const raw = readForm(ds, form), scope = readScope(form);
    return raw.historyTerms.length ? prepareForPatient(ds, raw).then(() => finish(raw, scope)) : finish(raw, scope);
  }
  function finish(raw, scope) {
    const t0 = performance.now();
    const analysis = evaluatePatient(raw, ds, { scope }); S.analysis = analysis;
    showErrors(form, analysis.validation.errors, analysis.validation.warnings); markStep('validated');
    markStep('evaluated'); markStep('generated');
    refreshResults(); renderPrintReport(analysis); drawGraphIfVisible();
    const b = $('#engineBadge'); b.textContent = `Deterministic rule engine v${analysis.meta.engineVersion} · rule-set ${analysis.meta.ruleSetVersion} · ${analysis.meta.evaluatedDrugs} drugs · ${(performance.now() - t0).toFixed(1)} ms`; b.className = 'live-badge';
    markStep('ready'); $('#resultsHeading').focus();
  }
  function refreshResults() {
    if (!S.analysis) return;
    renderNotices(S.analysis); renderSummary(S.analysis, S, (f) => { S.filter = f; refreshResults(); }); renderResults(S.analysis, S, openDrug);
  }
  function reset() {
    buildForm(ds, form); wireForm(); S.analysis = null; S.filter = 'all'; S.query = ''; $('#resultSearch').value = '';
    clear($('#notices')); clear($('#summaryChips')); clear($('#printReport')); clear($('#resultList')).append(h('div', { class: 'empty-state', text: 'Fill in what is known, then choose “Run analysis”.' }));
    $('#engineBadge').textContent = 'Deterministic rule engine — no analysis run yet'; resetTimeline(); drawGraphIfVisible();
  }
  $('#resultSearch').addEventListener('input', (e) => { S.query = e.target.value; refreshResults(); });

  // ---------- modal ----------
  const overlay = $('#modalOverlay');
  function openDrug(id) { const r = S.analysis?.results.find(x => x.drugId === id); if (r) return renderDrugModal(ds, r, S.analysis.patient.history.map(h => h.cui)); return renderCatalogModal(ds, id); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
  document.addEventListener('keydown', (e) => { for (const o of [overlay, $('#tourOverlay')]) { if (e.key === 'Escape' && o.classList.contains('open')) closeModal(o); trapTab(o, e); } });

  // ---------- directory: by drug (paginated) or by label side effect ----------
  let dirLimit = 60;
  const dirMode = () => ($('input[name=dirMode]:checked') || { value: 'drug' }).value;
  const covText = (d) => [`${(ds.rulesByDrug.get(d.id) || []).length} rule(s)`, `${d.sources.guidelines} guideline(s)`, d.sources.sider ? 'label data' : 'no label data', ...(ds.tggates.compounds[d.id]?.inVivo ? ['preclinical'] : [])].join(' · ');
  function drawDirectory() {
    const g = $('#dirGrid'), more = $('#dirMore'), effectBox = $('#effectBox'); clear(g);
    const effect = dirMode() === 'effect'; effectBox.hidden = !effect; g.hidden = effect; more.hidden = true;
    $('#dirSearch').placeholder = effect ? 'Search a side effect, e.g. Pancreatitis…' : 'Search medicine or class…'; $('#dirSearch').setAttribute('aria-label', effect ? 'Search side effects' : 'Search drug directory');
    if (effect) return drawEffectSearch();
    const s = $('#dirSearch').value.toLowerCase();
    const list = ds.drugs.filter(d => !s || d.name.toLowerCase().includes(s) || (d.class || '').toLowerCase().includes(s) || (d.aliases || []).some(a => a.toLowerCase().includes(s)));
    $('#dirCount').textContent = `${list.length} of ${ds.drugs.length} drugs`;
    if (!list.length) return g.append(h('div', { class: 'empty-state', text: 'No medications match your search.' }));
    list.slice(0, dirLimit).forEach(d => g.append(h('button', { type: 'button', class: 'dir-card', onclick: () => openDrug(d.id) }, h('div', { class: 'dname', text: d.name }), d.class ? h('div', { class: 'dclass', text: d.class }) : null,
      h('div', { class: `cov ${(ds.rulesByDrug.has(d.id)) ? 'cov-yes' : 'cov-no'}`, text: covText(d) }))));
    more.hidden = dirLimit >= list.length; more.textContent = `Show ${Math.min(60, list.length - dirLimit)} more`;
  }
  function drawEffectSearch() {
    const q = $('#dirSearch').value.trim().toLowerCase(), box = $('#effectTerms'); clear(box); clear($('#effectDrugs')); $('#dirCount').textContent = '';
    if (q.length < 2) return box.append(h('p', { class: 'hint', text: 'Type at least 2 letters to search the standard label terms (MedDRA).' }));
    const hits = Object.entries(ds.adverseTerms).filter(([, n]) => n.toLowerCase().includes(q)).sort((a, b) => a[1].length - b[1].length).slice(0, 20);
    if (!hits.length) return box.append(h('div', { class: 'empty-state', text: 'No label term matches your search.' }));
    hits.forEach(([cui, n]) => box.append(h('button', { type: 'button', class: 'chip-btn', onclick: () => showEffectDrugs(cui, n) }, n)));
  }
  async function showEffectDrugs(cui, name) {
    const out = $('#effectDrugs'); clear(out).append(h('p', { class: 'hint', text: 'Loading…' }));
    await loadTermBuckets(ds, [cui]);
    const rows = (ds.adverseByTerm.get(cui) || []).slice().sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]));
    clear(out).append(h('h4', { text: `${rows.length} drugs list “${name}” on their labels (SIDER 4.1)` }), h('p', { class: 'hint', text: 'Sorted by frequency band. Label listings only — not a comparison of risk.' }),
      h('div', { class: 'table-scroll' }, h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Drug' }), h('th', { text: 'Frequency per label' }))),
        h('tbody', {}, rows.slice(0, 100).map(r => h('tr', {}, h('td', {}, h('button', { type: 'button', class: 'link-btn', onclick: () => openDrug(r[0]), text: ds.drugById.get(r[0]).name })), h('td', { text: fmtFreq(r[1], null, null, null) })))))),
      rows.length > 100 ? h('p', { class: 'hint', text: `Showing the first 100 of ${rows.length}.` }) : null);
  }
  drawDirectory();
  $('#dirSearch').addEventListener('input', () => { dirLimit = 60; drawDirectory(); });
  $$('input[name=dirMode]').forEach(i => i.addEventListener('change', () => { dirLimit = 60; $('#dirSearch').value = ''; drawDirectory(); }));
  $('#dirMore').addEventListener('click', () => { dirLimit += 60; drawDirectory(); });

  // ---------- graph ----------
  const drawGraph = () => renderGraph(ds, () => S.analysis, {});
  const drawGraphIfVisible = () => { if (!$('#view-graph').hidden) drawGraph(); };
  $$('input[name=graphMode], .graph-filter').forEach(i => i.addEventListener('change', drawGraph));
  $('#graphSearch').addEventListener('input', drawGraph);

  // ---------- exports (same analysis object as on screen) ----------
  $('#exportCsv').addEventListener('click', () => {
    if (!S.analysis) return alert('Run an analysis first.');
    const url = URL.createObjectURL(new Blob([reportToCsv(S.analysis)], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: `genomx-report-${S.analysis.meta.generatedAt.slice(0, 10)}.csv` }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('#exportPrint').addEventListener('click', () => { if (!S.analysis) return alert('Run an analysis first.'); window.print(); });

  // ---------- first-time walkthrough ----------
  const tour = $('#tourOverlay'), tourCard = $('#tourCard');
  const STEPS = [
    ['This is an educational prototype', 'It is not clinically validated and must not be used for prescribing. Treat every output as something to verify against current primary sources.'],
    ['Enter what you know — and only that', 'Leave unknown fields unknown. Untested genes stay “Not tested”, and an unassessed allergy history stays “Not assessed”. Missing data is reported as missing, never as normal.'],
    ['Read the action categories', 'There is no safety score. “No flag” means no rule fired; it never means safe. “Info needed” and “Not assessed” are not clear results.'],
    ['Open any drug for the evidence', 'Each finding lists the rule ID, what triggered it, the source, and what is still unknown. Drug–drug interaction screening is not configured in this release.'],
  ];
  let step = 0;
  function drawTour() {
    clear(tourCard).append(h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close walkthrough', onclick: () => closeTour() }, '✕'), h('h2', { id: 'tourTitle', text: `How to use (${step + 1}/${STEPS.length}): ${STEPS[step][0]}` }), h('p', { text: STEPS[step][1] }),
      h('div', { class: 'btn-row' }, step > 0 ? h('button', { type: 'button', class: 'icon-btn', text: 'Back', onclick: () => { step--; drawTour(); } }) : null,
        h('button', { type: 'button', class: 'icon-btn', text: step < STEPS.length - 1 ? 'Next' : 'Got it', onclick: () => (step < STEPS.length - 1 ? (step++, drawTour()) : closeTour()) })));
    openModal(tour, tourCard, 'tourTitle');
  }
  function closeTour() { closeModal(tour); try { localStorage.setItem('genomx-tour-seen', '1'); } catch { /* ignore */ } }
  tour.addEventListener('click', (e) => { if (e.target === tour) closeTour(); });
  $('#howToBtn').addEventListener('click', () => { step = 0; drawTour(); });
  let seen = false; try { seen = !!localStorage.getItem('genomx-tour-seen'); } catch { /* ignore */ }
  if (!seen) { step = 0; drawTour(); }

  initTimeline(); drawGraphIfVisible();
  return { state: S, run, reset, show };
}

function renderMethodology(ds, root) {
  const by = {}; ds.rules.forEach(r => { by[r.status] = (by[r.status] || 0) + 1; });
  const p = (t) => h('p', { text: t }), li = (t) => h('li', { text: t });
  const bySrc = {}; ds.guidelines.forEach(g => { bySrc[g.source] = (bySrc[g.source] || 0) + 1; });
  const gOnly = [...ds.guidelinesByDrug.keys()].filter(k => !ds.rulesByDrug.has(k)).length;
  root.append(
    h('h3', { text: 'Decision policy' }), p('Each rule maps recorded patient data to an action category. For one drug, all findings are kept, and the overall category is the highest-precedence one:'),
    h('ol', {}, CATEGORIES.map(c => li(`${CATEGORY_SHORT[c]} — ${CATEGORY_LABEL[c]}`))),
    p('No numeric score is used, so a verified contraindication cannot be averaged away. “No flag” is only returned when at least one rule was available, every blocking input was present, and nothing fired. Label side-effect notes are annotations: they are listed but never change a category.'),
    h('h3', { text: 'Three layers of knowledge (strongest first)' }),
    h('ol', {}, [
      `Hand-encoded rules (${ds.rules.length}): each cites the guideline annotation(s) or regulator communication it was written from (${by.verified || 0} verified, ${by.citation_pending || 0} citation-pending class-level allergy checks). Only these can produce avoid / modify.`,
      `Published-guideline pointers (${ds.guidelines.length} ClinPGx guideline annotations — ${Object.entries(bySrc).map(([k, v]) => `${k} ${v}`).join(', ')} — covering ${ds.guidelinesByDrug.size} drugs; ${gOnly} of them have no hand-encoded rule): when a non-normal result is recorded for a gene a guideline addresses, the guideline summaries are shown side by side. They are never turned into avoid/modify.`,
      `Label side effects (SIDER 4.1: ${Object.keys(ds.adverseIndex.drugs).length} drugs, ${ds.adverseIndex.pairs.toLocaleString()} drug–effect pairs): browsable per drug and searchable by effect; matches to recorded conditions are informational only.`,
      `Preclinical liver data (Open TG-GATEs: ${Object.values(ds.tggates.compounds).filter(c => c.inVivo).length} drugs with rat in-vivo blood chemistry; ${Object.values(ds.tggates.compounds).filter(c => c.liverEnzymeSignal).length} show an ALT/AST signal ≥2× control): per-drug fold-change tables, shown in the drug detail; a liver-related recorded history adds an informational note. Rat data, supratherapeutic doses — not human evidence, and no flag is not reassurance.`].map(li)),
    h('h3', { text: 'Data sources and licences' }),
    h('ul', { class: 'plain' }, (ds.sources?.sources || []).map(x => h('li', {}, h('strong', { text: x.name + ': ' }), `${x.license}. `, x.obligations || x.limitations || ''))),
    p(ATTRIBUTION),
    h('h3', { text: 'Hand-encoded evidence records' }), h('ul', { class: 'plain' }, ds.evidence.map(e => h('li', {}, `${e.org}, ${e.year} — ${e.title} `, h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer', text: '[source]' }), ` (${e.type.replace(/_/g, ' ')})`))),
    p(ds.meta.evidenceNote),
    h('h3', { text: 'What is NOT in this release' }),
    h('ul', { class: 'plain' }, [
      'Drug–drug interaction screening: no verified dataset is configured, so none is performed.',
      'Drug–disease, hepatic and pregnancy rules: none verified. Pregnancy status is recorded but not used.',
      'Dosing: no dose is calculated. Doses appear only as figures quoted from a cited guideline.',
      'Guideline prose is not parsed into actions; only the hand-encoded rules produce avoid/modify.',
      'CPIC/PharmGKB evidence-level labels are not shown (not present in the provided data).',
      'Genotype → phenotype translation is not performed: enter the phenotype reported by a laboratory or CPIC-compatible tool.',
      'Gene-expression analysis: the TG-GATEs CEL arrays are not processed (no probeset annotation was provided), so no expression-based toxicity signal exists here.',
      'SIDER is a mid-2010s label snapshot with no severity grading and frequency for only a minority of pairs; drug names were merged (147 duplicates).'].map(li)),
    h('h3', { text: 'Privacy' }), p('All analysis runs locally in this page. Nothing is transmitted and no patient data is stored; only the theme and walkthrough-seen preferences use browser storage. Do not enter real names.'),
    h('div', { class: 'disclaimer' }, h('strong', { text: 'Prototype notice. ' }), 'This tool has not been clinically validated or assessed as a medical device. Consult the cited guidelines, the current drug label and a qualified clinician or pharmacist for real decisions.'));
}
