// Dataset assembly + schema validation. Pure functions: no I/O, so the engine runs in Node, the browser
// or a future backend. File loading lives in loadDatasetFromFs() (Node only, dynamic import).
import { CATEGORIES, RULE_STATUSES } from './constants.js';

const RULE_FILES = ['pgx', 'allergy', 'renal', 'age_context'];

export function buildDataset(files) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);

  const drugs = files.drugs.drugs;
  const drugById = new Map(), nameIndex = new Map();
  for (const d of drugs) {
    if (drugById.has(d.id)) err(`duplicate drug id ${d.id}`);
    drugById.set(d.id, d);
    for (const n of [d.name, d.id, ...(d.aliases || [])]) {
      const k = n.toLowerCase();
      if (nameIndex.has(k) && nameIndex.get(k) !== d.id) err(`ambiguous drug name/alias "${n}" -> ${nameIndex.get(k)} and ${d.id}`);
      nameIndex.set(k, d.id);
    }
  }
  const geneById = new Map(files.genes.genes.map(g => [g.id, g]));
  const evidenceById = new Map();
  for (const e of files.evidence.evidence) {
    if (evidenceById.has(e.id)) err(`duplicate evidence id ${e.id}`);
    for (const f of ['id', 'org', 'title', 'url', 'year', 'type', 'retrieved']) if (!e[f]) err(`evidence ${e.id} missing ${f}`);
    if (e.url && !/^https:\/\//.test(e.url)) err(`evidence ${e.id} url must be https`);
    evidenceById.set(e.id, e);
  }

  const rules = [], ruleById = new Map();
  for (const f of RULE_FILES) for (const r of (files.rules[f]?.rules || [])) {
    if (ruleById.has(r.id)) { err(`duplicate rule id ${r.id}`); continue; }
    for (const k of ['id', 'version', 'status', 'module', 'drug', 'condition', 'action', 'headline', 'rationale']) if (r[k] == null) err(`rule ${r.id} missing ${k}`);
    if (!drugById.has(r.drug)) err(`rule ${r.id} references unknown drug ${r.drug}`);
    if (!CATEGORIES.includes(r.action)) err(`rule ${r.id} has invalid action ${r.action}`);
    if (!RULE_STATUSES.includes(r.status)) err(`rule ${r.id} has invalid status ${r.status}`);
    for (const id of r.evidence || []) if (!evidenceById.has(id)) err(`rule ${r.id} cites unknown evidence ${id}`);
    if (r.status !== 'citation_pending' && !(r.evidence || []).length) err(`rule ${r.id} is "${r.status}" but cites no evidence`);
    if (r.status === 'citation_pending' && (r.evidence || []).length) warn(`rule ${r.id} is citation_pending but has evidence; upgrade its status`);
    if (r.status === 'verified' && (r.evidence || []).every(id => evidenceById.get(id)?.type === 'secondary_summary')) err(`rule ${r.id} is "verified" but only has secondary evidence (use verified_secondary)`);
    if (r.evidenceLevel != null) warn(`rule ${r.id} records an evidenceLevel; confirm it against the source`);
    if (r.condition?.type === 'pgx') {
      const g = geneById.get(r.condition.gene);
      if (!g) err(`rule ${r.id} references unknown gene ${r.condition.gene}`);
      else for (const p of r.condition.phenotypeIn || []) if (!g.phenotypes.includes(p)) err(`rule ${r.id} uses phenotype "${p}" not defined for ${g.id}`);
    }
    ruleById.set(r.id, r); rules.push(r);
  }
  const rulesByDrug = new Map();
  for (const r of rules) { if (!rulesByDrug.has(r.drug)) rulesByDrug.set(r.drug, []); rulesByDrug.get(r.drug).push(r); }

  const unverified = files.unverified.associations;
  for (const a of unverified) {
    if (!drugById.has(a.drug)) err(`unverified association unknown drug ${a.drug}`);
    if (!geneById.has(a.gene)) err(`unverified association unknown gene ${a.gene}`);
  }
  const unverifiedByDrug = new Map();
  for (const a of unverified) { if (!unverifiedByDrug.has(a.drug)) unverifiedByDrug.set(a.drug, []); unverifiedByDrug.get(a.drug).push(a); }

  return {
    meta: files.meta, genes: files.genes, vocab: files.vocab, evidence: files.evidence.evidence, interactions: files.interactions,
    drugs, drugById, nameIndex, geneById, evidenceById, rules, ruleById, rulesByDrug, unverifiedByDrug,
    validation: { errors, warnings },
  };
}

export async function loadDatasetFromFs(root) {
  const fs = await import('node:fs'); const path = await import('node:path');
  const rd = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
  return buildDataset({
    meta: rd('data/meta.json'), genes: rd('data/genes.json'), vocab: rd('data/vocab.json'), evidence: rd('data/evidence.json'),
    drugs: rd('data/drugs.json'), interactions: rd('data/interactions.json'), unverified: rd('data/unverified/associations.json'),
    rules: Object.fromEntries(RULE_FILES.map(f => [f, rd(`data/rules/${f}.json`)])),
  });
}

export async function loadDatasetFromUrls(base) {
  const get = async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`Failed to load ${p}: HTTP ${r.status}`); return r.json(); };
  const [meta, genes, vocab, evidence, drugs, interactions, unverified, ...rules] = await Promise.all([
    get('data/meta.json'), get('data/genes.json'), get('data/vocab.json'), get('data/evidence.json'), get('data/drugs.json'),
    get('data/interactions.json'), get('data/unverified/associations.json'), ...RULE_FILES.map(f => get(`data/rules/${f}.json`))]);
  return buildDataset({ meta, genes, vocab, evidence, drugs, interactions, unverified, rules: Object.fromEntries(RULE_FILES.map((f, i) => [f, rules[i]])) });
}
