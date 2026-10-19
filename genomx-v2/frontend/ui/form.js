import { h, $, $$, clear } from './dom.js';
import { normalizePatient } from '../../engine/index.js';

// Builds the structured patient form and reads it back into the raw patient object the engine validates.
const sel = (id, opts, value, label, describedBy) => h('select', { id, 'aria-describedby': describedBy }, opts.map(o => h('option', { value: o.id ?? o, selected: (o.id ?? o) === value, text: o.label ?? o })));
const field = (id, label, control, hint) => h('div', { class: 'field' }, h('label', { for: id, text: label }), control, hint && h('span', { class: 'hint', id: `${id}-hint`, text: hint }), h('span', { class: 'field-error', id: `${id}-err`, role: 'alert' }));

export function buildForm(ds, root) {
  clear(root);
  const YN = [{ id: 'unknown', label: 'Unknown / not recorded' }, { id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }, { id: 'not_applicable', label: 'Not applicable' }];
  root.append(
    h('p', { class: 'section-label' }, h('span', { class: 'num', text: '1' }), 'Patient context'),
    h('div', { class: 'field-row' },
      field('pPseudonym', 'Pseudonym / ID (optional)', h('input', { id: 'pPseudonym', type: 'text', maxlength: 40, autocomplete: 'off', placeholder: 'e.g. case-014 (no real names)' }), 'Not stored or transmitted.'),
      field('pAge', 'Age (years)', h('input', { id: 'pAge', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'e.g. 42 or 0.5', 'aria-describedby': 'pAge-err' })),
      field('pPregnancy', 'Pregnancy', sel('pPregnancy', YN, 'unknown'), 'Recorded only — no verified pregnancy rule exists yet.'),
      field('pBreastfeeding', 'Breastfeeding', sel('pBreastfeeding', YN, 'unknown')),
      field('pIndication', 'Intended indication', sel('pIndication', ds.vocab.indications, 'unknown'), 'Some guidance depends on the indication.'),
      field('pEgfr', 'eGFR (mL/min/1.73 m²)', h('input', { id: 'pEgfr', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: 'measured/reported value' }), 'A "normal/impaired" choice is not used.'),
      field('pEgfrDate', 'eGFR date', h('input', { id: 'pEgfrDate', type: 'date' }))),

    h('p', { class: 'section-label', class: 'mt16' }, h('span', { class: 'num', text: '2' }), 'Genetic results'),
    h('p', { class: 'hint' }, 'Leave a gene as "Not tested" if there is no result. Missing data is never treated as a normal result.'),
    h('input', { type: 'search', class: 'search-input', id: 'geneSearch', placeholder: 'Filter genes…', 'aria-label': 'Filter genes' }),
    h('div', { class: 'gene-table', id: 'geneTable', role: 'group', 'aria-label': 'Genetic results' }, ds.genes.genes.map(g => geneRow(ds, g))),

    h('p', { class: 'section-label', class: 'mt16' }, h('span', { class: 'num', text: '3' }), 'Allergy history'),
    h('div', { class: 'field' }, h('label', { for: 'pAllergyStatus', text: 'History assessed?' }),
      sel('pAllergyStatus', [{ id: 'not_assessed', label: 'Not assessed' }, { id: 'none_known', label: 'Assessed — no known drug allergies' }, { id: 'recorded', label: 'Allergies recorded below' }], 'not_assessed')),
    h('div', { id: 'allergyList' }),
    h('button', { type: 'button', class: 'icon-btn', id: 'addAllergy', text: '+ Add allergy entry' }),

    h('p', { class: 'section-label', class: 'mt16' }, h('span', { class: 'num', text: '4' }), 'Current medications'),
    field('pMeds', 'One per line or comma-separated', h('textarea', { id: 'pMeds', rows: 3, placeholder: 'e.g. warfarin 5 mg\nPlavix' }), 'Names are matched by ingredient; unrecognised names are reported, not ignored.'),

    h('p', { class: 'section-label', class: 'mt16' }, h('span', { class: 'num', text: '5' }), 'Treatment history'),
    h('p', { class: 'hint' }, 'Only drugs whose guidance depends on prior use are listed.'),
    h('div', { class: 'field-row', id: 'exposureRow' }, exposureDrugs(ds).map(d => field(`ex-${d.id}`, d.name, sel(`ex-${d.id}`, ds.vocab.exposure, 'unknown')))),
    h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'run', id: 'runBtn', text: 'Run analysis' }), h('button', { type: 'button', class: 'icon-btn', id: 'resetBtn', text: 'Reset' })),
    h('p', { class: 'field-error', id: 'formErrors', role: 'alert' }));

  $('#addAllergy', root).addEventListener('click', () => addAllergyRow(ds, $('#allergyList', root)));
  $('#geneSearch', root).addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase(); $$('.gene-row', root).forEach(r => { r.hidden = !!q && !r.dataset.label.toLowerCase().includes(q); });
  });
}

export const exposureDrugs = (ds) => [...new Set(ds.rules.filter(r => r.requires?.priorExposure).map(r => r.drug))].map(id => ds.drugById.get(id));

function geneRow(ds, g) {
  const status = h('select', { id: `gs-${g.id}`, 'aria-label': `${g.label} status` }, Object.entries(ds.genes.genotypeStatuses).map(([k, v]) => h('option', { value: k, text: v })));
  const result = h('select', { id: `gr-${g.id}`, 'aria-label': `${g.label} result`, disabled: true }, [h('option', { value: '', text: '—' }), ...g.phenotypes.map(p => h('option', { value: p, text: p.replace(/_/g, ' ') }))]);
  status.addEventListener('change', () => { result.disabled = status.value !== 'result_available'; if (result.disabled) result.value = ''; });
  return h('div', { class: 'gene-row', dataset: { label: g.label } }, h('span', { class: 'gene-name mono', text: g.label }), status, result);
}

export function addAllergyRow(ds, list, v = {}) {
  const row = h('fieldset', { class: 'allergy-row' }, h('legend', { text: 'Allergy entry' }),
    h('div', { class: 'field-row' },
      h('select', { 'aria-label': 'Substance class', class: 'al-class' }, ds.vocab.allergyClasses.map(c => h('option', { value: c.id, text: c.label }))),
      h('select', { 'aria-label': 'Certainty', class: 'al-status' }, ds.vocab.allergyStatuses.map(s => h('option', { value: s.id, text: s.label }))),
      h('input', { class: 'al-reaction', type: 'text', maxlength: 120, placeholder: 'Reaction (e.g. urticaria)', 'aria-label': 'Reaction' }),
      h('select', { 'aria-label': 'Severity', class: 'al-severity' }, ['unknown', 'mild', 'moderate', 'severe'].map(s => h('option', { value: s, text: 'Severity: ' + s }))),
      h('input', { class: 'al-date', type: 'date', 'aria-label': 'Date of reaction' }),
      h('input', { class: 'al-source', type: 'text', maxlength: 80, placeholder: 'Source (e.g. GP record)', 'aria-label': 'Source' }),
      h('select', { 'aria-label': 'Confidence', class: 'al-confidence' }, ['unknown', 'high', 'medium', 'low'].map(s => h('option', { value: s, text: 'Confidence: ' + s })))),
    h('button', { type: 'button', class: 'icon-btn', text: 'Remove', onclick: (e) => e.target.closest('fieldset').remove() }));
  list.append(row); return row;
}

export function readForm(ds, root) {
  const v = (id) => (root.querySelector(`[id="${id}"]`) || {}).value ?? ''; // attribute selector: gene ids contain * and :
  const genotypes = {};
  for (const g of ds.genes.genes) genotypes[g.id] = { status: v(`gs-${g.id}`), phenotype: v(`gr-${g.id}`) };
  const allergies = $$('.allergy-row', root).map(r => ({ substanceClass: $('.al-class', r).value, status: $('.al-status', r).value, reaction: $('.al-reaction', r).value.trim(), severity: $('.al-severity', r).value,
    date: $('.al-date', r).value, source: $('.al-source', r).value.trim(), confidence: $('.al-confidence', r).value }));
  const priorExposure = {}; for (const d of exposureDrugs(ds)) priorExposure[d.id] = v(`ex-${d.id}`);
  return { pseudonym: v('pPseudonym').trim(), age: v('pAge').trim(), pregnancy: v('pPregnancy'), breastfeeding: v('pBreastfeeding'), indication: v('pIndication'),
    egfrValue: v('pEgfr').trim(), egfrDate: v('pEgfrDate'), allergyHistoryStatus: v('pAllergyStatus'), allergies, genotypes, priorExposure,
    currentMedications: v('pMeds').split(/[\n,;]+/).map(s => s.trim()).filter(Boolean) };
}

const FIELD_MAP = { age: 'pAge', egfrValue: 'pEgfr', egfrDate: 'pEgfrDate', pregnancy: 'pPregnancy', breastfeeding: 'pBreastfeeding', indication: 'pIndication' };
export function showErrors(root, errors, warnings = []) {
  $$('.field-error', root).forEach(e => { e.textContent = ''; }); $$('[aria-invalid]', root).forEach(e => e.removeAttribute('aria-invalid'));
  const general = [];
  for (const e of errors) {
    const id = FIELD_MAP[e.field];
    if (id && $('#' + id + '-err', root)) { $('#' + id + '-err', root).textContent = e.message; $('#' + id, root).setAttribute('aria-invalid', 'true'); } else general.push(e.message);
  }
  for (const w of warnings) { const id = FIELD_MAP[w.field]; if (id && $('#' + id + '-err', root) && !$('#' + id + '-err', root).textContent) $('#' + id + '-err', root).textContent = '⚠ ' + w.message; }
  $('#formErrors', root).textContent = general.join(' ');
}

export function validateLive(ds, root) { const p = normalizePatient(readForm(ds, root), ds); showErrors(root, p.errors, p.warnings); return p; }
