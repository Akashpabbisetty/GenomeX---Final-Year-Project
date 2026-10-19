import { CATEGORIES, CATEGORY_LABEL } from './constants.js';
import { statusText } from './explain.js';

export const ATTRIBUTION = 'Contains data from ClinPGx (https://www.clinpgx.org), CC BY-SA 4.0 — restructured/summarised, changes made. Adverse-effect listings from SIDER 4.1 (label-derived; verify its licence before redistribution). Rules are hand-encoded from cited sources.';

export const DISCLAIMER = 'EDUCATIONAL PROTOTYPE — not clinically validated, not a medical device, and not for prescribing decisions. Findings reflect only the limited rule set listed below and the data entered; absence of a finding is not evidence of safety. All output requires review by a qualified clinician or pharmacist against current primary sources.';

// One model feeds BOTH the printable report and the CSV, so they cannot diverge from the on-screen results.
export function buildReport(analysis, opts = {}) {
  const groups = CATEGORIES.map(c => ({ category: c, label: CATEGORY_LABEL[c], drugs: analysis.results.filter(r => r.overall.category === c) }))
    .filter(g => g.drugs.length && (opts.includeNoFlag !== false || g.category !== 'no_flag'));
  return {
    title: 'GenomX Advisor — Medication Review Report (prototype)', attribution: ATTRIBUTION, scope: analysis.meta.scope, generatedAt: analysis.meta.generatedAt, ruleSetVersion: analysis.meta.ruleSetVersion,
    appVersion: analysis.meta.appVersion, disclaimer: DISCLAIMER,
    patient: { pseudonym: analysis.patient.pseudonym || '(none)', age: analysis.patient.age },
    completeness: analysis.completeness, notices: analysis.notices, inputsNotUsed: analysis.inputsNotUsed, validation: analysis.validation, groups,
  };
}

const neutralise = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return s; };
const cell = (v) => `"${neutralise(v).replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;

export const CSV_HEADER = ['Drug', 'Overall action', 'Finding rule ID', 'Rule version', 'Rule status', 'Finding', 'Triggering inputs', 'Rationale', 'Monitoring', 'Evidence', 'Missing information', 'Limitations', 'Rule-set version', 'Generated at', 'Data attribution'];

export function reportToCsv(analysis) {
  const rows = [CSV_HEADER];
  for (const r of analysis.results) {
    const missing = r.missingInfo.map(m => `${m.field}${m.blocking ? ' (blocking)' : ''}: ${m.reason}`).join(' | ');
    const base = [r.name, r.overall.label];
    const tail = [r.ruleSetVersion, r.timestamp, 'ClinPGx (CC BY-SA 4.0); SIDER 4.1; hand-encoded rules'];
    if (!r.findings.length) rows.push([...base, '', '', '', r.summary, '', '', '', '', missing, '', ...tail]);
    for (const f of r.findings) rows.push([...base, f.ruleId, f.ruleVersion, statusText(f.status), f.headline,
      f.triggers.map(t => `${t.field}=${t.value}`).join('; '), f.rationale, f.monitoring.join('; '), f.evidence.map(e => `${e.org} ${e.year}: ${e.title} <${e.url}>`).join(' | '),
      missing, [...f.limitations, ...f.caveats].join(' | '), ...tail]);
  }
  return '\uFEFF' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
