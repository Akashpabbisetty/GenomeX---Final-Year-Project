// Dataset assembly + schema validation. Pure functions: no I/O, so the engine runs in Node, the browser
// or a future backend. File loading is isolated in loadDatasetFromFs() / loadDatasetFromUrls(), which also attach
// `ds.io` for LAZY loading of the large SIDER shards (per-drug effect lists and per-term inverted index).
import { CATEGORIES, RULE_STATUSES } from './constants.js';

const RULE_FILES = ['pgx', 'allergy', 'renal', 'age_context'];
const HLA_RE = /HLA-([AB])\*?(\d{2}):?(\d{2,3})/g;
export const bucketOf = (cui) => parseInt(cui.slice(1), 10) % 64;
export const bucketFile = (cui) => `data/adverse/by_term/b${String(bucketOf(cui)).padStart(2, '0')}.json`;

export function ruleGenes(rule) {
  const c = rule.condition;
  return c.type === 'pgx' ? [c.gene] : c.type === 'pgx_all' ? c.all.map(x => x.gene) : [];
}

export function guidelineEvidence(g, retrieved) {
  return { id: 'G:' + g.id, org: g.source, title: g.name, url: g.url, year: (g.lastUpdated || '').slice(0, 4) || 'n.d.', type: 'guideline_annotation', retrieved,
    note: `ClinPGx annotation; last updated ${g.lastUpdated || 'date not recorded'}. Contains data from ClinPGx (CC BY-SA 4.0).` };
}

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
  const geneCatalog = new Map((files.geneCatalog?.genes || []).map(g => [g.symbol, g]));
  for (const g of files.genes.genes) {
    if (!g.symbol) err(`gene ${g.id} has no symbol`);
    else if (files.geneCatalog && !geneCatalog.has(g.symbol)) err(`gene ${g.id}: symbol ${g.symbol} not in the ClinPGx gene catalog`);
  }

  // ---- guideline index (ClinPGx) ----
  const guidelines = files.guidelines?.guidelines || [];
  const retrieved = (files.guidelines?.created || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const retrievedIso = retrieved ? `${retrieved[3]}-${retrieved[1]}-${retrieved[2]}` : 'unknown';
  const guidelineById = new Map(), guidelinesByDrug = new Map();
  for (const g of guidelines) {
    if (guidelineById.has(g.id)) err(`duplicate guideline ${g.id}`);
    guidelineById.set(g.id, g);
    if (!/^https:\/\//.test(g.url || '')) err(`guideline ${g.id} has a non-https url`);
    for (const c of g.drugs) {
      if (!drugById.has(c.drugId)) { err(`guideline ${g.id} references unknown drug ${c.drugId}`); continue; }
      if (!guidelinesByDrug.has(c.drugId)) guidelinesByDrug.set(c.drugId, []);
      guidelinesByDrug.get(c.drugId).push(g);
    }
    for (const s of g.genes) if (files.geneCatalog && !geneCatalog.has(s)) warn(`guideline ${g.id}: gene ${s} missing from gene catalog`);
  }
  const SRC_ORDER = { CPIC: 0, DPWG: 1 };
  for (const list of guidelinesByDrug.values()) list.sort((a, b) => (SRC_ORDER[a.source] ?? 9) - (SRC_ORDER[b.source] ?? 9) || (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
  // map each guideline's gene symbols onto the patient-input panel (HLA family symbols need the allele to be named in the text)
  const guidelineGeneMap = new Map();
  for (const g of guidelines) {
    const text = `${g.name} ${g.summary}`, mentioned = new Set();
    for (const m of text.matchAll(HLA_RE)) mentioned.add(`HLA-${m[1]}*${m[2]}:${m[3].slice(0, 2)}`);
    const ids = new Set();
    for (const s of g.genes) for (const pg of files.genes.genes) {
      if (pg.id === s) ids.add(pg.id);
      else if (pg.family === s && pg.id.includes('*') && mentioned.has(pg.id)) ids.add(pg.id);
    }
    guidelineGeneMap.set(g.id, [...ids]);
  }

  // ---- evidence ----
  const evidenceById = new Map();
  for (const e of files.evidence.evidence) {
    if (evidenceById.has(e.id)) err(`duplicate evidence id ${e.id}`);
    for (const f of ['id', 'org', 'title', 'url', 'year', 'type', 'retrieved']) if (!e[f]) err(`evidence ${e.id} missing ${f}`);
    if (e.url && !/^https:\/\//.test(e.url)) err(`evidence ${e.id} url must be https`);
    evidenceById.set(e.id, e);
  }
  for (const g of guidelines) evidenceById.set('G:' + g.id, guidelineEvidence(g, retrievedIso));
  const hasEvidence = (id) => evidenceById.has(id);

  // ---- rules ----
  const rules = [], ruleById = new Map();
  const checkCond = (r, c) => {
    if (c.type === 'pgx') {
      const g = geneById.get(c.gene);
      if (!g) err(`rule ${r.id} references unknown gene ${c.gene}`);
      else for (const p of c.phenotypeIn || []) if (!g.phenotypes.includes(p)) err(`rule ${r.id} uses phenotype "${p}" not defined for ${g.id}`);
    } else if (c.type === 'pgx_all') { if (!c.all?.length) err(`rule ${r.id} has empty pgx_all`); else c.all.forEach(x => checkCond(r, x)); }
  };
  for (const f of RULE_FILES) for (const r of (files.rules[f]?.rules || [])) {
    if (ruleById.has(r.id)) { err(`duplicate rule id ${r.id}`); continue; }
    for (const k of ['id', 'version', 'status', 'module', 'drug', 'condition', 'action', 'headline', 'rationale']) if (r[k] == null) err(`rule ${r.id} missing ${k}`);
    if (!drugById.has(r.drug)) err(`rule ${r.id} references unknown drug ${r.drug}`);
    if (!CATEGORIES.includes(r.action)) err(`rule ${r.id} has invalid action ${r.action}`);
    if (!RULE_STATUSES.includes(r.status)) err(`rule ${r.id} has invalid status ${r.status}`);
    for (const id of r.evidence || []) if (!hasEvidence(id)) err(`rule ${r.id} cites unknown evidence ${id}`);
    for (const id of r.alternatives?.evidence || []) if (!hasEvidence(id)) err(`rule ${r.id} alternative cites unknown evidence ${id}`);
    if (r.alternatives?.supported && !(r.alternatives.evidence || []).length) err(`rule ${r.id} claims a supported alternative without evidence`);
    if (r.status !== 'citation_pending' && !(r.evidence || []).length) err(`rule ${r.id} is "${r.status}" but cites no evidence`);
    if (r.status === 'citation_pending' && (r.evidence || []).length) warn(`rule ${r.id} is citation_pending but has evidence; upgrade its status`);
    if (r.status === 'verified' && (r.evidence || []).every(id => evidenceById.get(id)?.type === 'secondary_summary')) err(`rule ${r.id} is "verified" but only has secondary evidence (use verified_secondary)`);
    if (r.evidenceLevel != null) warn(`rule ${r.id} records an evidenceLevel; confirm it against the source`);
    checkCond(r, r.condition);
    ruleById.set(r.id, r); rules.push(r);
  }
  const rulesByDrug = new Map();
  for (const r of rules) { if (!rulesByDrug.has(r.drug)) rulesByDrug.set(r.drug, []); rulesByDrug.get(r.drug).push(r); }

  const adverseIndex = files.adverseIndex || { drugs: {} };
  for (const id of Object.keys(adverseIndex.drugs)) if (!drugById.has(id)) err(`adverse index references unknown drug ${id}`);

  // ---- Open TG-GATEs (preclinical) index ----
  const tg = files.tggates || { compounds: {}, excluded: [], liverTermCuis: [] };
  for (const id of Object.keys(tg.compounds)) if (!drugById.has(id)) err(`tggates index references unknown drug ${id}`);
  const liverTerms = new Set(tg.liverTermCuis);
  for (const c of liverTerms) if (files.adverseTerms && Object.keys(files.adverseTerms).length && !files.adverseTerms[c]) err(`tggates liver term ${c} is not a known label term`);

  return {
    meta: files.meta, genes: files.genes, vocab: files.vocab, evidence: files.evidence.evidence, interactions: files.interactions, sources: files.sources || null,
    drugs, drugById, nameIndex, geneById, geneCatalog, evidenceById, rules, ruleById, rulesByDrug,
    guidelines, guidelineById, guidelinesByDrug, guidelineGeneMap, guidelineAttribution: files.guidelines?.attribution || null,
    tggates: { ...tg, liverTerms }, tggatesCache: new Map(), adverseIndex, adverseTerms: files.adverseTerms || {}, hasTerms: Object.keys(files.adverseTerms || {}).length > 0, adverseByTerm: new Map(), adverseDrugCache: new Map(), io: null,
    validation: { errors, warnings },
  };
}

// ---------- lazy SIDER access (async; the evaluation itself stays synchronous) ----------
export async function loadAdverseDrug(ds, drugId) {
  if (ds.adverseDrugCache.has(drugId)) return ds.adverseDrugCache.get(drugId);
  if (!(drugId in ds.adverseIndex.drugs)) return null;
  const d = await ds.io.json(`data/adverse/drug/${drugId}.json`);
  ds.adverseDrugCache.set(drugId, d); return d;
}
export async function loadTgGates(ds, drugId) {
  if (ds.tggatesCache.has(drugId)) return ds.tggatesCache.get(drugId);
  if (!ds.tggates.compounds[drugId]) return null;
  const d = await ds.io.json(`data/tggates/compound/${drugId}.json`); ds.tggatesCache.set(drugId, d); return d;
}
export async function loadTermBuckets(ds, cuis) {
  const need = [...new Set(cuis.filter(c => !ds.adverseByTerm.has(c)))];
  const files = [...new Set(need.map(bucketFile))];
  await Promise.all(files.map(async (f) => { const b = await ds.io.json(f); for (const [cui, rows] of Object.entries(b)) ds.adverseByTerm.set(cui, rows); }));
  for (const c of need) if (!ds.adverseByTerm.has(c)) ds.adverseByTerm.set(c, []);   // term with no drugs: remember it
}

const FILES = ['meta', 'genes', 'vocab', 'evidence', 'drugs', 'interactions', 'gene_catalog', 'sources', 'guidelines/index', 'adverse/index', 'adverse/terms', 'tggates/index'];
const rules = (get) => Promise.all(RULE_FILES.map(f => get(`data/rules/${f}.json`)));
async function assemble(get) {
  const [meta, genes, vocab, evidence, drugs, interactions, geneCatalog, sources, guidelines, adverseIndex, adverseTerms, tggates] = await Promise.all(FILES.map(f => get(`data/${f}.json`)));
  const rs = await rules(get);
  const ds = buildDataset({ meta, genes, vocab, evidence, drugs, interactions, geneCatalog, sources, guidelines, adverseIndex, adverseTerms, tggates, rules: Object.fromEntries(RULE_FILES.map((f, i) => [f, rs[i]])) });
  ds.io = { json: get }; return ds;
}
export async function loadDatasetFromFs(root) {
  const fs = await import('node:fs'); const path = await import('node:path');
  return assemble(async (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')));
}
export async function loadDatasetFromUrls(base) {
  return assemble(async (p) => { const r = await fetch(base + p); if (!r.ok) throw new Error(`Failed to load ${p}: HTTP ${r.status}`); return r.json(); });
}
