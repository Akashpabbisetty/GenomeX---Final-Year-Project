import { h, $, $$, clear, badge, safeLink, openModal, closeModal } from './dom.js';
import { CATEGORIES, CATEGORY_LABEL, CATEGORY_SHORT, explainFinding, statusText, buildReport } from '../../engine/index.js';

const MODULE_LABEL = { pgx: 'Pharmacogenomic', allergy: 'Allergy', renal: 'Renal function', age: 'Age', breastfeeding: 'Breastfeeding', interaction: 'Drug–drug interaction', duplicate: 'Duplicate therapy', unverified: 'Unverified association' };
const MODULE_ORDER = ['pgx', 'allergy', 'renal', 'age', 'breastfeeding', 'interaction', 'duplicate', 'unverified'];
const moduleOf = (f) => (f.module === 'age_context' ? 'age' : f.module);

export function renderSummary(analysis, state, onFilter) {
  const bar = $('#summaryChips'); clear(bar);
  bar.append(h('button', { type: 'button', class: `chip-btn${state.filter === 'all' ? ' active' : ''}`, 'aria-pressed': String(state.filter === 'all'), onclick: () => onFilter('all') }, `All (${analysis.results.length})`));
  for (const c of CATEGORIES) bar.append(h('button', { type: 'button', class: `chip-btn cat-${c}${state.filter === c ? ' active' : ''}`, 'aria-pressed': String(state.filter === c), onclick: () => onFilter(c) },
    h('span', { 'aria-hidden': 'true', text: '' }), `${CATEGORY_SHORT[c]} (${analysis.summaryByCategory[c]})`));
}

export function renderNotices(analysis) {
  const box = $('#notices'); clear(box);
  const c = analysis.completeness;
  box.append(h('div', { class: 'completeness' }, h('label', { for: 'completeBar', text: `Input completeness for the verified rules: ${c.provided}/${c.total} (${c.percent}%)` }),
    h('progress', { id: 'completeBar', max: c.total, value: c.provided }),
    h('details', {}, h('summary', { text: 'What is missing?' }), h('ul', {}, c.items.map(i => h('li', { class: i.provided ? 'ok' : 'miss', text: `${i.provided ? '✓' : '✗'} ${i.label}` }))))));
  for (const n of analysis.notices) box.append(h('div', { class: `notice ${n.level}`, role: 'note' }, h('strong', { text: n.level === 'warning' ? '⚠ ' : 'ℹ ' }), n.message));
  for (const u of analysis.inputsNotUsed) box.append(h('div', { class: 'notice info', role: 'note' }, h('strong', { text: 'Not used: ' }), `${u.field} — ${u.reason}`));
  for (const w of analysis.validation.errors) box.append(h('div', { class: 'notice error', role: 'alert' }, h('strong', { text: '✖ Input error: ' }), w.message));
}

function card(r, onOpen) {
  const top = r.findings.filter(f => f.category !== 'informational').slice(0, 2);
  const used = [...new Set(r.findings.flatMap(f => f.triggers.map(t => t.field)))];
  return h('button', { type: 'button', class: `drug-track cat-${r.overall.category}`, dataset: { drug: r.drugId }, 'aria-label': `${r.name}: ${CATEGORY_LABEL[r.overall.category]}. Open details.`, onclick: () => onOpen(r.drugId) },
    h('div', { class: 'drug-row-top' }, h('span', { class: 'drug-name', text: r.name }), badge(r.overall.category, CATEGORY_SHORT)),
    h('div', { class: 'drug-class', text: r.class }),
    h('div', { class: 'drug-reason', text: r.summary }),
    top.map(f => h('div', { class: 'finding-line' }, h('span', { class: 'mod', text: MODULE_LABEL[moduleOf(f)] + ': ' }), f.headline)),
    used.length ? h('div', { class: 'used' }, 'Inputs that affected this: ', used.map(u => h('span', { class: 'chip', text: u }))) : null,
    r.missingInfo.some(m => m.blocking) ? h('div', { class: 'missing-line' }, 'Missing: ', [...new Set(r.missingInfo.filter(m => m.blocking).map(m => m.field))].join(', ')) : null);
}

export function renderResults(analysis, state, onOpen) {
  const list = $('#resultList'); clear(list);
  const q = state.query.toLowerCase();
  const visible = analysis.results.filter(r => (state.filter === 'all' || r.overall.category === state.filter) && (!q || r.name.toLowerCase().includes(q) || r.class.toLowerCase().includes(q)));
  if (!visible.length) { list.append(h('div', { class: 'empty-state', text: 'No medications match the current filter.' })); return; }
  for (const c of CATEGORIES) {
    const group = visible.filter(r => r.overall.category === c); if (!group.length) continue;
    list.append(h('section', { class: 'result-group', 'aria-labelledby': `grp-${c}` }, h('h3', { id: `grp-${c}`, class: `grp-head cat-${c}` }, badge(c, CATEGORY_SHORT), ' ', CATEGORY_LABEL[c], h('span', { class: 'count-pill', text: String(group.length) })), group.map(r => card(r, onOpen))));
  }
}

function section(title, ...kids) { return h('div', { class: 'modal-section' }, h('h4', { text: title }), ...kids); }
const list = (items) => h('ul', { class: 'plain' }, items.map(i => h('li', { text: i })));

function findingBlock(f) {
  const x = explainFinding(f);
  return h('article', { class: `finding cat-${f.category}` },
    h('div', { class: 'finding-head' }, badge(f.category, CATEGORY_SHORT), h('strong', { text: ' ' + x.detected })),
    h('dl', { class: 'finding-dl' },
      h('dt', { text: 'Why it matters' }), h('dd', { text: x.whyItMatters }),
      h('dt', { text: 'Triggered by' }), h('dd', {}, list(x.triggeredBy)),
      h('dt', { text: 'Mechanism' }), h('dd', { text: x.mechanism }),
      h('dt', { text: 'Action category' }), h('dd', { text: x.action }),
      h('dt', { text: 'Monitoring' }), h('dd', {}, list(x.monitoring)),
      h('dt', { text: 'Evidence' }), h('dd', {}, x.evidence.length ? x.evidence.map(e => h('div', { class: 'ev' }, safeLink(e.url, e.label), h('span', { class: 'ev-type', text: ` [${e.type.replace('_', ' ')}]` }))) : h('em', { text: 'No source linked.' }),
        h('div', { class: `evstatus ev-${f.status}`, text: x.evidenceStatus }), f.strength ? h('div', { text: `Recommendation strength (as recorded): ${f.strength}` }) : null),
      f.caveats.length ? [h('dt', { text: 'Caveats' }), h('dd', {}, list(f.caveats))] : null,
      x.limitations.length ? [h('dt', { text: 'Limitations' }), h('dd', {}, list(x.limitations))] : null,
      h('dt', { text: 'Rule' }), h('dd', { class: 'mono', text: `${f.ruleId} v${f.ruleVersion}` })));
}

export function renderDrugModal(ds, r) {
  const card = $('#modalCard'); clear(card);
  const rules = ds.rulesByDrug.get(r?.drugId || '') || [];
  card.append(h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close dialog', id: 'modalCloseBtn', onclick: () => closeModal($('#modalOverlay')) }, '✕'),
    h('h2', { id: 'modalTitle', text: r.name }), h('div', { class: 'mclass', text: r.class }),
    h('div', { class: `overall cat-${r.overall.category}` }, badge(r.overall.category, CATEGORY_SHORT), h('strong', { text: ' ' + CATEGORY_LABEL[r.overall.category] }), h('p', { text: r.summary })));
  for (const m of MODULE_ORDER) { const fs = r.findings.filter(f => moduleOf(f) === m); if (fs.length) card.append(section(MODULE_LABEL[m] + (fs.length > 1 ? ` (${fs.length})` : ''), fs.map(findingBlock))); }
  if (!r.findings.length) card.append(section('Findings', h('p', { text: 'No rule produced a finding for the recorded data.' })));
  card.append(section('What remains unknown', r.missingInfo.length ? h('ul', { class: 'plain' }, r.missingInfo.map(m => h('li', { text: `${m.field}${m.blocking ? ' (blocking)' : ''}: ${m.reason}` }))) : h('p', { text: 'No missing inputs for the available rules.' }),
    h('p', { class: 'hint', text: 'Interactions, dosing, indication appropriateness, hepatic function and pregnancy were not assessed unless shown above.' })));
  card.append(section('Alternatives', h('p', { text: r.alternatives.supported.length ? r.alternatives.supported.join('; ') : r.alternatives.note })));
  card.append(section('Rules evaluated', r.rulesEvaluated.length ? h('table', { class: 'mini' }, h('thead', {}, h('tr', {}, h('th', { text: 'Rule' }), h('th', { text: 'Outcome' }))), h('tbody', {}, r.rulesEvaluated.map(e => h('tr', {}, h('td', { class: 'mono', text: e.ruleId }), h('td', { text: e.outcome }))))) : h('p', { text: 'None — this release has no verified rules for this drug.' })));
  card.append(h('p', { class: 'hint mono', text: `Rule-set ${r.ruleSetVersion} · evaluated ${r.timestamp} · coverage: ${r.coverage.verifiedRules} verified / ${r.coverage.citationPendingRules} citation-pending rules / ${r.coverage.unverifiedAssociations} unverified associations · uncertainty: ${r.uncertainty}` }));
  openModal($('#modalOverlay'), card, 'modalTitle');
}

// Directory modal for a drug when no analysis exists yet (catalog facts only: nothing unverified is displayed).
export function renderCatalogModal(ds, id) {
  const d = ds.drugById.get(id), card = $('#modalCard'); clear(card);
  const rules = ds.rulesByDrug.get(id) || [], unv = ds.unverifiedByDrug.get(id) || [];
  card.append(h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Close dialog', onclick: () => closeModal($('#modalOverlay')) }, '✕'), h('h2', { id: 'modalTitle', text: d.name }), h('div', { class: 'mclass', text: d.class }),
    section('Rules in this release', rules.length ? rules.map(r => h('div', { class: 'ruleline' }, h('strong', { text: r.headline }), h('div', { class: 'mono', text: `${r.id} v${r.version}` }), h('div', { class: `evstatus ev-${r.status}`, text: statusText(r.status) }), r.evidence.map(e => h('div', {}, safeLink(ds.evidenceById.get(e).url, `${ds.evidenceById.get(e).org}, ${ds.evidenceById.get(e).year}`))))) : h('p', { text: 'No verified rules for this drug in this release. It is not assessed.' })),
    unv.length ? section('Unverified associations (informational only)', list(unv.map(u => `${u.gene} — recommendation not verified`))) : null,
    h('p', { class: 'hint', text: 'Uses, mechanism, side-effect, contraindication and alternative text from the prototype was removed pending verification. Consult the current FDA label and CPIC/ClinPGx.' }));
  openModal($('#modalOverlay'), card, 'modalTitle');
}

// ----- timeline: stamps are real wall-clock times of real stages -----
const STEPS = [['session', 'Session started'], ['validated', 'Inputs validated'], ['evaluated', 'Rules evaluated'], ['generated', 'Findings generated'], ['ready', 'Ready for clinician review']];
export function initTimeline() { const t = $('#timeline'); clear(t); STEPS.forEach(([k, l]) => t.append(h('div', { class: 'tl-step', id: `tl-${k}` }, h('div', { class: 'tl-line' }), h('div', { class: 'tl-dot' }), h('p', { text: l }), h('span', { class: 'tl-time', text: 'pending' })))); markStep('session'); }
export function markStep(k, pending = false) { const el = $('#tl-' + k); if (!el) return; el.classList.toggle('active', !pending); $('.tl-time', el).textContent = pending ? 'pending' : new Date().toLocaleTimeString(); }
export function resetTimeline() { STEPS.slice(1).forEach(([k]) => markStep(k, true)); }

// ----- print report (same model as CSV) -----
export function renderPrintReport(analysis) {
  const rep = buildReport(analysis), root = $('#printReport'); clear(root);
  root.append(h('h1', { text: rep.title }), h('p', { class: 'disclaimer-print', text: rep.disclaimer }),
    h('p', { class: 'mono', text: `Generated ${rep.generatedAt} · app ${rep.appVersion} · rule-set ${rep.ruleSetVersion} · patient ${rep.patient.pseudonym}${rep.patient.age != null ? ` · age ${rep.patient.age}` : ''}` }),
    h('p', { text: `Input completeness for verified rules: ${rep.completeness.provided}/${rep.completeness.total} (${rep.completeness.percent}%). Missing: ${rep.completeness.items.filter(i => !i.provided).map(i => i.label).join(', ') || 'none'}.` }),
    rep.notices.map(n => h('p', { class: 'notice-print', text: `Notice: ${n.message}` })), rep.inputsNotUsed.map(n => h('p', { class: 'notice-print', text: `Not used: ${n.field} — ${n.reason}` })));
  for (const g of rep.groups) {
    root.append(h('h2', { text: `${g.label} (${g.drugs.length})` }));
    for (const r of g.drugs) {
      root.append(h('div', { class: 'print-drug' }, h('h3', { text: `${r.name} — ${CATEGORY_SHORT[r.overall.category]}` }), h('p', { text: r.summary }),
        r.findings.map(f => h('div', { class: 'print-finding' }, h('strong', { text: `[${MODULE_LABEL[moduleOf(f)]}] ${f.headline}` }), h('div', { text: f.rationale }), h('div', { class: 'mono', text: `${f.ruleId} v${f.ruleVersion} · ${statusText(f.status)} · triggers: ${f.triggers.map(t => `${t.field}=${t.value}`).join('; ')}` }),
          f.monitoring.length ? h('div', { text: 'Monitoring: ' + f.monitoring.join('; ') }) : null, f.evidence.map(e => h('div', { class: 'mono', text: `Source: ${e.org} ${e.year} — ${e.title} — ${e.url}` })), [...f.caveats, ...f.limitations].length ? h('div', { text: 'Limitations: ' + [...f.caveats, ...f.limitations].join(' | ') }) : null)),
        r.missingInfo.length ? h('p', { text: 'Unknown: ' + r.missingInfo.map(m => `${m.field}${m.blocking ? ' (blocking)' : ''}`).join(', ') }) : null));
    }
  }
}
