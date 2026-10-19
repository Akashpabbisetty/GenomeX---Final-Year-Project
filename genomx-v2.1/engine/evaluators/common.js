import { exposureFor } from '../patient.js';

const REQ_TEXT = {
  priorExposure: (allowed) => `the patient has ${allowed.includes('naive') ? 'not previously taken' : 'previously taken'} this drug`,
  indication: (allowed) => `the indication is: ${allowed.join(' / ')}`,
};

// Evaluates a rule's `requires` block. Returns 'met' | 'unknown' | 'unmet' plus human text.
export function checkRequires(rule, ctx) {
  const out = { status: 'met', notes: [], missing: [] };
  for (const [key, allowed] of Object.entries(rule.requires || {})) {
    let actual;
    if (key === 'priorExposure') actual = exposureFor(ctx.patient, ctx.drugId);
    else if (key === 'indication') actual = ctx.patient.indication;
    else { out.status = 'unknown'; out.notes.push(`Unsupported requirement "${key}".`); continue; }
    const need = REQ_TEXT[key](allowed);
    if (actual === 'unknown') {
      if (out.status === 'met') out.status = 'unknown';
      out.notes.push(`This rule applies only if ${need}; that was not provided.`);
      out.missing.push({ field: key === 'priorExposure' ? `exposure.${ctx.drugId}` : key, reason: `Needed to know whether ${need}.`, blocking: false });
    } else if (!allowed.includes(actual)) {
      out.status = 'unmet';
      out.notes.push(`This rule is defined for cases where ${need}; the recorded context differs (${actual}). Clinician review required.`);
    }
  }
  return out;
}

// Turns a matched condition into an outcome, honouring the rule's context requirements.
export function applyMatched(rule, ctx, triggers, caveats = []) {
  const req = checkRequires(rule, ctx);
  if (req.status === 'met') return { outcome: 'applied', category: rule.action, triggers, caveats, missing: [] };
  if (req.status === 'unmet' && rule.onUnmetContext === 'skip') return { outcome: 'not_applicable', triggers: [], caveats: [], missing: [] };
  return { outcome: 'applied', category: 'conditional', triggers, caveats: [...caveats, ...req.notes], missing: req.missing, conditionalOn: rule.action };
}

export const notEvaluable = (field, reason, blocking) => ({ outcome: 'not_evaluable', triggers: [], caveats: [], missing: [{ field, reason, blocking }] });
export const notApplicable = () => ({ outcome: 'not_applicable', triggers: [], caveats: [], missing: [] });
