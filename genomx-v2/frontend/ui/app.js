import { h, $, $$, clear, badge, openModal, closeModal, trapTab } from './dom.js';
import { buildForm, readForm, validateLive, showErrors, addAllergyRow } from './form.js';
import { renderSummary, renderNotices, renderResults, renderDrugModal, renderCatalogModal, initTimeline, markStep, resetTimeline, renderPrintReport } from './results.js';
import { renderGraph } from './graph.js';
import { evaluatePatient, reportToCsv, CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT } from '../../engine/index.js';

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

  // ---------- form ----------
  buildForm(ds, form);
  const wireForm = () => {
    ['pAge', 'pEgfr', 'pEgfrDate'].forEach(id => $('#' + id, form).addEventListener('change', () => validateLive(ds, form)));
    $('#runBtn', form).addEventListener('click', run); $('#resetBtn', form).addEventListener('click', reset);
  };
  wireForm();

  function run() {
    resetTimeline(); const raw = readForm(ds, form);
    const t0 = performance.now();
    const analysis = evaluatePatient(raw, ds); S.analysis = analysis;
    showErrors(form, analysis.validation.errors, analysis.validation.warnings); markStep('validated');
    markStep('evaluated'); markStep('generated');
    refreshResults(); renderPrintReport(analysis); drawGraphIfVisible();
    const b = $('#engineBadge'); b.textContent = `Deterministic rule engine v${analysis.meta.engineVersion} · rule-set ${analysis.meta.ruleSetVersion} · ${(performance.now() - t0).toFixed(1)} ms`; b.className = 'live-badge';
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
  function openDrug(id) { const r = S.analysis?.results.find(x => x.drugId === id); if (r) renderDrugModal(ds, r); else renderCatalogModal(ds, id); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
  document.addEventListener('keydown', (e) => { for (const o of [overlay, $('#tourOverlay')]) { if (e.key === 'Escape' && o.classList.contains('open')) closeModal(o); trapTab(o, e); } });

  // ---------- directory ----------
  function drawDirectory(q = '') {
    const g = $('#dirGrid'); clear(g); const s = q.toLowerCase();
    const list = ds.drugs.filter(d => !s || d.name.toLowerCase().includes(s) || d.class.toLowerCase().includes(s));
    if (!list.length) return g.append(h('div', { class: 'empty-state', text: 'No medications match your search.' }));
    list.forEach(d => { const n = (ds.rulesByDrug.get(d.id) || []).filter(r => r.status !== 'citation_pending').length;
      g.append(h('button', { type: 'button', class: 'dir-card', onclick: () => renderCatalogModal(ds, d.id) }, h('div', { class: 'dname', text: d.name }), h('div', { class: 'dclass', text: d.class }),
        h('div', { class: `cov ${n ? 'cov-yes' : 'cov-no'}`, text: n ? `${n} verified rule${n > 1 ? 's' : ''}` : 'No verified rules (not assessed)' }))); });
  }
  drawDirectory(); $('#dirSearch').addEventListener('input', (e) => drawDirectory(e.target.value));

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
  root.append(
    h('h3', { text: 'Decision policy' }), p('Each rule maps recorded patient data to an action category. For one drug, all findings are kept, and the overall category is the highest-precedence one:'),
    h('ol', {}, CATEGORIES.map(c => li(`${CATEGORY_SHORT[c]} — ${CATEGORY_LABEL[c]}`))),
    p('No numeric score is used, so a verified contraindication cannot be averaged away. “No flag” is only returned when at least one rule was available, every blocking input was present, and nothing fired.'),
    h('h3', { text: 'Data status' }),
    p(`Rule-set ${ds.meta.ruleSetVersion}: ${ds.rules.length} rules (${by.verified || 0} verified against a primary source, ${by.verified_secondary || 0} verified against a secondary summary, ${by.citation_pending || 0} citation-pending), ${ds.evidence.length} evidence records. Evidence was read on ${ds.meta.evidenceRetrieved}; guidelines are updated over time and must be re-checked.`),
    p(ds.meta.evidenceNote),
    h('h3', { text: 'Evidence records' }), h('ul', { class: 'plain' }, ds.evidence.map(e => h('li', {}, `${e.org}, ${e.year} — ${e.title} `, h('a', { href: e.url, target: '_blank', rel: 'noopener noreferrer', text: '[source]' }), ` (${e.type.replace('_', ' ')})`))),
    h('h3', { text: 'What is NOT in this release' }),
    h('ul', { class: 'plain' }, [
      'Drug–drug interaction screening: no verified dataset is configured, so none is performed (an earlier hand-written table was removed as unsourced).',
      'Drug–disease, hepatic and pregnancy rules: none verified. Pregnancy and hepatic status are not used.',
      'Dosing: no dose is calculated or recommended.',
      'Alternative-medication recommendations: none are encoded (each would need individual verification).',
      'Confidence percentages and CPIC/PharmGKB evidence-level labels: removed; levels could not be retrieved and are not assumed.',
      `Coverage: ${ds.drugs.filter(d => (ds.rulesByDrug.get(d.id) || []).some(r => r.status !== 'citation_pending')).length} of ${ds.drugs.length} catalog drugs have at least one verified rule; the rest are reported as not assessed.`,
      'Genotype → phenotype translation is not performed: enter the phenotype reported by a laboratory or CPIC-compatible tool.'].map(li)),
    h('h3', { text: 'Privacy' }), p('All analysis runs locally in this page. Nothing is transmitted and no patient data is stored; only the theme and walkthrough-seen preferences use browser storage. Do not enter real names.'),
    h('div', { class: 'disclaimer' }, h('strong', { text: 'Prototype notice. ' }), 'This tool has not been clinically validated or assessed as a medical device. Consult CPIC/ClinPGx, the current drug label and a qualified clinician or pharmacist for real decisions.'));
}
