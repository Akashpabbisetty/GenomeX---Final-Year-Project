import { h, $, $$, clear, badge, safeLink, openModal, closeModal } from './dom.js';
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT, explainFinding, statusText, buildReport, loadAdverseDrug, fmtFreq } from '../../engine/index.js';

const MODULE_LABEL = { pgx: 'Pharmacogenomic (encoded rule)', guideline: 'Published guideline pointer', allergy: 'Allergy', renal: 'Renal function', age: 'Age', breastfeeding: 'Breastfeeding', interaction: 'Drug–drug interaction', duplicate: 'Duplicate therapy', adverse_label: 'Label side effect (SIDER)' };
const MODULE_ORDER = ['pgx', 'guideline', 'allergy', 'renal', 'age', 'breastfeeding', 'interaction', 'duplicate', 'adverse_label'];
const moduleOf = (f) => (f.module === 'age_context' ? 'age' : f.module);
const COLLAPSED = new Set(['informational', 'no_flag']);
const PAGE = 40;
export const ATTRIBUTION = 'Guideline and gene data: ClinPGx (https://www.clinpgx.org), CC BY-SA 4.0 — restructured and summarised. Label side-effect data: SIDER 4.1 (label-derived; verify its licence before redistribution).';

export function renderSummary(analysis, state, onFilter) {
  const bar = $('#summaryChips'); clear(bar);
  bar.append(h('button', { type: 'button', class: `chip-btn${state.filter === 'all' ? ' active' : ''}`, 'aria-pressed': String(state.filter === 'all'), onclick: () => onFilter('all') }, `All (${analysis.results.length})`));
  for (const c of CATEGORIES) bar.append(h('button', { type: 'button', class: `chip-btn cat-${c}${state.filter === c ? ' active' : ''}`, 'aria-pressed': String(state.filter === c), onclick: () => onFilter(c) }, `${CATEGORY_SHORT[c]} (${analysis.summaryByCategory[c]})`));
}

export function renderNotices(analysis) {
  const box = $('#notices'); clear(box);
  const c = analysis.completeness;
  box.append(h('div', { class: 'completeness' }, h('label', { for: 'completeBar', text: `Input completeness for the hand-encoded rules: ${c.provided}/${c.total} (${c.percent}%) — ${analysis.meta.evaluatedDrugs} drugs evaluated` }),
    h('progress', { id: 'completeBar', max: c.total, value: c.provided }),
    h('details', {}, h('summary', { text: 'What is missing?' }), h('ul', {}, c.items.map(i => h('li', { class: i.provided ? 'ok' : 'miss', text: `${i.provided ? '✓' : '✗'} ${i.label}` }))))));
  for (const n of analysis.notices) box.append(h('div', { class: `notice ${n.level}`, role: 'note' }, h('strong', { text: n.level === 'warning' ? '⚠ ' : 'ℹ ' }), n.message));
  for (const u of analysis.inputsNotUsed) box.append(h('div', { class: 'notice info', role: 'note' }, h('strong', { text: 'Not used: ' }), `${u.field} — ${u.reason}`));
  for (const w of analysis.validation.errors) box.append(h('div', { class: 'notice error', role: 'alert' }, h('strong', { text: '✖ Input error: ' }), w.message));
}

function covChips(r) {
  const c = r.coverage;
  return h('div', { class: 'cov-row' },
    h('span', { class: `cov-chip ${c.totalRules ? 'on' : ''}`, text: `Rules ${c.totalRules}` }), h('span', { class: `cov-chip ${c.guidelines ? 'on' : ''}`, text: `Guidelines ${c.guidelines}` }),
    h('span', { class: `cov-chip ${c.labelEffects ? 'on' : ''}`, text: c.labelEffects ? `Label effects ${c.labelEffects}` : 'No label data' }));
}

function card(r, onOpen) {
  const top = r.findings.filter(f => !['informational'].includes(f.category) || f.module === 'guideline').slice(0, 2);
  const notes = r.findings.filter(f => f.module === 'adverse_label').length;
  const used = [...new Set(r.findings.filter(f => !f.annotation).flatMap(f => f.triggers.map(t => t.field)))];
  return h('button', { type: 'button', class: `drug-track cat-${r.overall.category}`, dataset: { drug: r.drugId }, 'aria-label': `${r.name}: ${CATEGORY_LABEL[r.overall.category]}. Open details.`, onclick: () => onOpen(r.drugId) },
    h('div', { class: 'drug-row-top' }, h('span', { class: 'drug-name', text: r.name }), badge(r.overall.category, CATEGORY_SHORT)),
    r.class ? h('div', { class: 'drug-class', text: r.class }) : null,
    h('div', { class: 'drug-reason', text: r.summary }),
    top.map(f => h('div', { class: 'finding-line' }, h('span', { class: 'mod', text: MODULE_LABEL[moduleOf(f)] + ': ' }), f.headline)),
    notes ? h('div', { class: 'used', text: `${notes} label note${notes > 1 ? 's' : ''} matching the recorded history (informational)` }) : null,
    used.length ? h('div', { class: 'used' }, 'Inputs that affected this: ', used.map(u => h('span', { class: 'chip', text: u }))) : null,
    r.missingInfo.some(m => m.blocking) ? h('div', { class: 'missing-line' }, 'Missing: ', [...new Set(r.missingInfo.filter(m => m.blocking).map(m => m.field))].join(', ')) : null,
    covChips(r));
}

export function renderResults(analysis, state, onOpen) {
  const list = $('#resultList'); clear(list);
  const q = state.query.toLowerCase();
  const visible = analysis.results.filter(r => (state.filter === 'all' || r.overall.category === state.filter) && (!q || r.name.toLowerCase().includes(q) || (r.class || '').toLowerCase().includes(q)));
  if (!visible.length) { list.append(h('div', { class: 'empty-state', text: 'No medications match the current filter.' })); return; }
  for (const c of CATEGORIES) {
    const group = visible.filter(r => r.overall.category === c); if (!group.length) continue;
    const body = h('div', { class: 'group-body' });
    let shown = 0;
    const more = h('button', { type: 'button', class: 'icon-btn more-btn' });
    const draw = () => { group.slice(shown, shown + PAGE).forEach(r => body.insertBefore(card(r, onOpen), more)); shown = Math.min(group.length, shown + PAGE); more.hidden = shown >= group.length; more.textContent = `Show ${Math.min(PAGE, group.length - shown)} more (${group.length - shown} remaining)`; };
    body.append(more); more.addEventListener('click', draw); draw();
    const head = [badge(c, CATEGORY_SHORT), ' ', CATEGORY_LABEL[c], h('span', { class: 'count-pill', text: String(group.length) })];
    // routine groups are collapsed by default so that actionable findings are never buried under hundreds of cards
    const collapsed = COLLAPSED.has(c) && state.filter === 'all' && !q;
    list.append(h('details', { class: `result-group grp-${c}`, open: !collapsed }, h('summary', { class: `grp-head cat-${c}` }, ...head), body));
  }
}

function section(title, ...kids) { return h('div', { class: 'modal-section' }, h('h4', { text: title }), ...kids); }
const list = (items) => h('ul', { class: 'plain' }, items.map(i => h('li', { text: i })));
const lead = (t) => t.split(' || ')[0].split(/\[(?:CPIC|DPWG|RNPGx|CPNDS|ACR|[A-Za-z]+),/)[0].trim();

function guidelineBlocks(gs) {
  return gs.map(g => h('div', { class: 'gl-block' },
    h('div', { class: 'gl-head' }, h('span', { class: `src src-${g.source}`, text: g.source }), ' ', safeLink(g.url, g.name || g.id), h('span', { class: 'ev-type', text: ` · updated ${g.lastUpdated || 'n.d.'} · ${g.recommendation ? 'contains a recommendation' : 'states no recommendation / no action'}` })),
    h('p', { class: 'gl-summary', text: g.summary })));
}

function findingBlock(f) {
  const x = explainFinding(f);
  return h('article', { class: `finding cat-${f.category}` },
    h('div', { class: 'finding-head' }, badge(f.category, CATEGORY_SHORT), h('strong', { text: ' ' + x.detected })),
    h('dl', { class: 'finding-dl' },
      h('dt', { text: 'Why it matters' }), h('dd', { text: f.guidelines ? lead(x.whyItMatters) : x.whyItMatters }),
      f.guidelines ? [h('dt', { text: 'Sources (side by side)' }), h('dd', {}, guidelineBlocks(f.guidelines.map(g => ({ ...g, name: null }))))] : null,
      h('dt', { text: 'Triggered by' }), h('dd', {}, list(x.triggeredBy)),
      h('dt', { text: 'Mechanism' }), h('dd', { text: x.mechanism }),
      h('dt', { text: 'Action category' }), h('dd', { text: x.action }),
      h('dt', { text: 'Monitoring' }), h('dd', {}, list(x.monitoring)),
      h('dt', { text: 'Evidence' }), h('dd', {}, x.evidence.length ? x.evidence.map(e => h('div', { class: 'ev' }, safeLink(e.url, e.label), h('span', { class: 'ev-type', text: ` [${e.type.replace(/_/g, ' ')}]` }))) : h('em', { text: 'No source linked.' }),
        h('div', { class: `evstatus ev-${f.status}`, text: x.evidenceStatus }), f.strength ? h('div', { text: `Recommendation strength (as recorded): ${f.strength}` }) : null),
      f.caveats.length ? [h('dt', { text: 'Caveats' }), h('dd', {}, list(f.caveats))] : null,
      x.limitations.length ? [h('dt', { text: 'Limitations' }), h('dd', {}, list(x.limitations))] : null,
      h('dt', { text: 'Rule' }), h('dd', { class: 'mono', text: `${f.ruleId} v${f.ruleVersion}` })));
}

// ---- label side effects (SIDER), loaded on demand ----
export async function renderEffects(ds, drugId, box, historyCuis = []) {
  clear(box).append(h('p', { class: 'hint', text: 'Loading label data…' }));
  let d; try { d = await loadAdverseDrug(ds, drugId); } catch { clear(box).append(h('div', { class: 'notice error', role: 'alert', text: 'Label data could not be loaded.' })); return; }
  if (!d) { clear(box).append(h('p', { text: 'SIDER has no label side-effect data for this drug.' })); return; }
  const hist = new Set(historyCuis); let limit = 25, q = '';
  const tbody = h('tbody'), count = h('p', { class: 'hint' }), more = h('button', { type: 'button', class: 'icon-btn' });
  const draw = () => {
    const rows = d.effects.filter(e => !q || ds.adverseTerms[e[0]].toLowerCase().includes(q)); clear(tbody);
    rows.slice(0, limit).forEach(e => tbody.append(h('tr', {}, h('td', { text: ds.adverseTerms[e[0]] }), h('td', { text: fmtFreq(e[1], e[2], e[3], e[4]) }), h('td', { text: hist.has(e[0]) ? '★ in recorded history' : '' }))));
    count.textContent = `Showing ${Math.min(limit, rows.length)} of ${rows.length} label-listed effects${q ? ' matching your search' : ''} (sorted by frequency band, then name).`;
    more.hidden = limit >= rows.length; more.textContent = `Show ${Math.min(100, rows.length - limit)} more`;
  };
  more.addEventListener('click', () => { limit += 100; draw(); });
  clear(box).append(
    h('p', { class: 'hint', text: `SIDER 4.1 names: ${d.siderNames.join(', ')}${d.cids.length > 1 ? ` (${d.cids.length} compound IDs merged)` : ''}. ${d.note || ''}` }),
    h('input', { type: 'search', class: 'search-input', 'aria-label': 'Filter label effects', placeholder: 'Filter effects…', oninput: (e) => { q = e.target.value.toLowerCase(); limit = 25; draw(); } }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Effect (MedDRA PT)' }), h('th', { text: 'Frequency per label (as encoded by SIDER)' }), h('th', { text: 'Match' }))), tbody)), count, more,
    h('p', { class: 'hint', text: 'Label-derived listing, not a prediction for any patient; no severity grading; descriptive words are mapped to ranges by SIDER; mid-2010s snapshot.' }));
  draw();
}

function commonSections(ds, card, r, historyCuis) {
  card.append(section('Published guidelines (ClinPGx)', r.relatedGuidelines.length ? [h('p', { class: 'hint', text: `${r.relatedGuidelines.length} guideline annotation(s). Sources may disagree; no reconciliation is attempted.` }), guidelineBlocks(r.relatedGuidelines)] : h('p', { text: 'No published guideline annotation for this drug in the dataset.' })));
  const box = h('div', { class: 'effects-box', id: 'effectsBox' }); card.append(section('Label-listed adverse effects (SIDER)', box));
  card.append(h('p', { class: 'hint', text: ATTRIBUTION }));
  return renderEffects(ds, r.drugId, box, historyCuis);
}

export function renderDrugModal(ds, r, historyCuis = []) {
  const card = $('#modalCard'); clear(card);
  card.append(h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close dialog', id: 'modalCloseBtn', onclick: () => closeModal($('#modalOverlay')) }, '✕'),
    h('h2', { id: 'modalTitle', text: r.name }), r.class ? h('div', { class: 'mclass', text: r.class }) : null,
    h('div', { class: `overall cat-${r.overall.category}` }, badge(r.overall.category, CATEGORY_SHORT), h('strong', { text: ' ' + CATEGORY_LABEL[r.overall.category] }), h('p', { text: r.summary })));
  for (const m of MODULE_ORDER) { const fs = r.findings.filter(f => moduleOf(f) === m); if (fs.length) card.append(section(MODULE_LABEL[m] + (fs.length > 1 ? ` (${fs.length})` : ''), fs.map(findingBlock))); }
  if (!r.findings.length) card.append(section('Findings', h('p', { text: 'No rule produced a finding for the recorded data.' })));
  card.append(section('What remains unknown', r.missingInfo.length ? h('ul', { class: 'plain' }, r.missingInfo.map(m => h('li', { text: `${m.field}${m.blocking ? ' (blocking)' : ''}: ${m.reason}` }))) : h('p', { text: 'No missing inputs for the available rules.' }),
    h('p', { class: 'hint', text: 'Interactions, dosing, indication appropriateness, hepatic function and pregnancy were not assessed unless shown above.' })));
  card.append(section('Alternatives (only where a cited guideline names them)', r.alternatives.supported.length
    ? r.alternatives.supported.map(a => h('div', {}, h('strong', { text: a.text }), ' ', a.evidence.map(e => safeLink(e.url, `[${e.org}]`)), ' ')) : h('p', { text: r.alternatives.note })));
  card.append(section('Rules evaluated', r.rulesEvaluated.length ? h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Rule' }), h('th', { text: 'Outcome' }))), h('tbody', {}, r.rulesEvaluated.map(e => h('tr', {}, h('td', { class: 'mono', text: e.ruleId }), h('td', { text: e.outcome }))))) : h('p', { text: 'None — no hand-encoded rule exists for this drug in this release.' })));
  card.append(h('p', { class: 'hint mono', text: `Rule-set ${r.ruleSetVersion} · evaluated ${r.timestamp} · coverage: ${r.coverage.verifiedRules} verified / ${r.coverage.citationPendingRules} citation-pending rules · ${r.coverage.guidelines} guidelines · ${r.coverage.labelEffects} label effects · uncertainty: ${r.uncertainty}` }));
  openModal($('#modalOverlay'), card, 'modalTitle');
  return commonSections(ds, card, r, historyCuis);
}

// Directory modal when no analysis exists yet (catalog facts only).
export function renderCatalogModal(ds, id) {
  const d = ds.drugById.get(id), card = $('#modalCard'); clear(card);
  const rules = ds.rulesByDrug.get(id) || [];
  const r = { drugId: id, relatedGuidelines: (ds.guidelinesByDrug.get(id) || []).map(g => ({ id: g.id, source: g.source, name: g.name, lastUpdated: g.lastUpdated, url: g.url, recommendation: g.flags.recommendation, summary: g.summary })) };
  card.append(h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close dialog', onclick: () => closeModal($('#modalOverlay')) }, '✕'), h('h2', { id: 'modalTitle', text: d.name }), d.class ? h('div', { class: 'mclass', text: d.class }) : null,
    d.note ? h('p', { class: 'hint', text: d.note }) : null,
    section('Hand-encoded rules in this release', rules.length ? rules.map(x => h('div', { class: 'ruleline' }, h('strong', { text: x.headline }), h('div', { class: 'mono', text: `${x.id} v${x.version}` }), h('div', { class: `evstatus ev-${x.status}`, text: statusText(x.status) }), x.evidence.map(e => h('div', {}, safeLink(ds.evidenceById.get(e).url, `${ds.evidenceById.get(e).org}, ${ds.evidenceById.get(e).year}`))))) : h('p', { text: 'No hand-encoded rule for this drug in this release; it is not assessed against patient data.' })));
  openModal($('#modalOverlay'), card, 'modalTitle');
  return commonSections(ds, card, r, []);
}

// ----- timeline: stamps are real wall-clock times of real stages -----
const STEPS = [['session', 'Session started'], ['validated', 'Inputs validated'], ['evaluated', 'Rules evaluated'], ['generated', 'Findings generated'], ['ready', 'Ready for clinician review']];
export function initTimeline() { const t = $('#timeline'); clear(t); STEPS.forEach(([k, l]) => t.append(h('div', { class: 'tl-step', id: `tl-${k}` }, h('div', { class: 'tl-line' }), h('div', { class: 'tl-dot' }), h('p', { text: l }), h('span', { class: 'tl-time', text: 'pending' })))); markStep('session'); }
export function markStep(k, pending = false) { const el = $('#tl-' + k); if (!el) return; el.classList.toggle('active', !pending); $('.tl-time', el).textContent = pending ? 'pending' : new Date().toLocaleTimeString(); }
export function resetTimeline() { STEPS.slice(1).forEach(([k]) => markStep(k, true)); }

// ----- print report (same model as CSV); routine drugs are compacted to one line each group -----
export function renderPrintReport(analysis) {
  const rep = buildReport(analysis), root = $('#printReport'); clear(root);
  root.append(h('h1', { text: rep.title }), h('p', { class: 'disclaimer-print', text: rep.disclaimer }),
    h('p', { class: 'mono', text: `Generated ${rep.generatedAt} · app ${rep.appVersion} · rule-set ${rep.ruleSetVersion} · scope ${rep.scope} · patient ${rep.patient.pseudonym}${rep.patient.age != null ? ` · age ${rep.patient.age}` : ''}` }),
    h('p', { text: `Input completeness for hand-encoded rules: ${rep.completeness.provided}/${rep.completeness.total} (${rep.completeness.percent}%). Missing: ${rep.completeness.items.filter(i => !i.provided).map(i => i.label).join(', ') || 'none'}.` }),
    rep.notices.map(n => h('p', { class: 'notice-print', text: `Notice: ${n.message}` })), rep.inputsNotUsed.map(n => h('p', { class: 'notice-print', text: `Not used: ${n.field} — ${n.reason}` })));
  for (const g of rep.groups) {
    root.append(h('h2', { text: `${g.label} (${g.drugs.length})` }));
    const routine = g.drugs.filter(r => !r.findings.some(f => !f.annotation) && !['avoid', 'modify', 'conditional', 'monitor', 'needs_info'].includes(g.category));
    const detailed = g.drugs.filter(r => !routine.includes(r));
    if (routine.length) root.append(h('p', { text: `${routine.map(r => r.name).join(', ')}.` }));
    for (const r of detailed) {
      root.append(h('div', { class: 'print-drug' }, h('h3', { text: `${r.name} — ${CATEGORY_SHORT[r.overall.category]}` }), h('p', { text: r.summary }),
        r.findings.filter(f => !f.annotation).map(f => h('div', { class: 'print-finding' }, h('strong', { text: `[${MODULE_LABEL[moduleOf(f)]}] ${f.headline}` }), h('div', { text: f.guidelines ? lead(f.rationale) : f.rationale }), h('div', { class: 'mono', text: `${f.ruleId} v${f.ruleVersion} · ${statusText(f.status)} · triggers: ${f.triggers.map(t => `${t.field}=${t.value}`).join('; ')}` }),
          f.monitoring.length ? h('div', { text: 'Monitoring: ' + f.monitoring.join('; ') }) : null, f.evidence.map(e => h('div', { class: 'mono', text: `Source: ${e.org} ${e.year} — ${e.title} — ${e.url}` })), [...f.caveats, ...f.limitations].length ? h('div', { text: 'Limitations: ' + [...f.caveats, ...f.limitations].join(' | ') }) : null)),
        r.findings.some(f => f.annotation) ? h('p', { text: `Label notes (informational): ${r.findings.filter(f => f.annotation).map(f => f.triggers[0].value).join(', ')}.` }) : null,
        r.missingInfo.filter(m => m.blocking).length ? h('p', { text: 'Unknown (blocking): ' + r.missingInfo.filter(m => m.blocking).map(m => m.field).join(', ') }) : null));
    }
  }
  root.append(h('p', { class: 'disclaimer-print', text: rep.attribution }));
}
