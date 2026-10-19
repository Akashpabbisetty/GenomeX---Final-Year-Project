import { h, $, $$, clear, safeLink } from './dom.js';
import { CATEGORY_SHORT, statusText } from '../../engine/index.js';

// ---- pure model builder (no DOM): relationships are created ONLY from rules / findings, never from shared category ----
export function buildGraphModel(ds, analysis, mode) {
  const nodes = new Map(), edges = [];
  const node = (id, kind, label, detail) => { if (!nodes.has(id)) nodes.set(id, { id, kind, label, detail }); return id; };
  const drugNode = (id) => node('drug:' + id, 'drug', ds.drugById.get(id).name, ds.drugById.get(id).class);
  const inputFor = (rule) => { const c = rule.condition;
    if (c.type === 'pgx') return node('gene:' + c.gene, 'gene', c.gene, 'Gene / allele');
    if (c.type === 'allergy') return node('allergy:' + c.substanceClass, 'allergy', ds.vocab.allergyClasses.find(a => a.id === c.substanceClass).label, 'Allergy class');
    if (c.type === 'egfr') return node('lab:egfr', 'lab', 'eGFR', 'Renal function (lab)');
    if (c.type === 'age') return node('ctx:age', 'context', 'Age', 'Patient context');
    return node('ctx:breastfeeding', 'context', 'Breastfeeding', 'Patient context'); };

  if (mode === 'catalog' || !analysis) {
    for (const r of ds.rules) edges.push({ id: r.id, from: inputFor(r), to: drugNode(r.drug), type: r.status === 'citation_pending' ? 'unverified' : 'confirmed', label: r.action === 'avoid' ? 'avoid' : r.action,
      ruleId: r.id, status: r.status, headline: r.headline, evidence: r.evidence.map(e => ds.evidenceById.get(e)) });
    for (const a of [...ds.unverifiedByDrug.values()].flat()) edges.push({ id: `U-${a.drug}-${a.gene}`, from: node('gene:' + a.gene, 'gene', a.gene, 'Gene / allele'), to: drugNode(a.drug), type: 'unverified', label: 'unverified',
      ruleId: null, status: 'unverified', headline: a.note, evidence: [] });
  } else {
    node('patient', 'patient', analysis.patient.pseudonym || 'Patient', 'Current analysis');
    for (const r of analysis.results) {
      for (const f of r.findings) {
        if (f.module === 'duplicate') continue;
        for (const t of f.triggers) {
          const from = node(`in:${t.field}:${t.value}`, t.field.startsWith('genotype') ? 'gene' : t.field.startsWith('allergy') ? 'allergy' : 'context', `${t.field.replace('genotype.', '')}: ${String(t.value).split(';')[0]}`, t.field);
          edges.push({ id: `${f.ruleId}|${from}`, from, to: drugNode(r.drugId), type: f.status === 'unverified' ? 'unverified' : f.category === 'conditional' ? 'unknown' : 'confirmed', label: CATEGORY_SHORT[f.category],
            ruleId: f.ruleId, status: f.status, headline: f.headline, evidence: f.evidence });
        }
      }
      for (const m of r.missingInfo.filter(x => x.blocking)) {
        const from = node(`miss:${m.field}`, 'missing', `${m.field.replace('genotype.', '')} (not provided)`, 'Missing input');
        edges.push({ id: `${m.ruleId}|${from}`, from, to: drugNode(r.drugId), type: 'unknown', label: 'result needed', ruleId: m.ruleId, status: 'unknown', headline: m.reason, evidence: [] });
      }
    }
    for (const [id] of nodes) if (id.startsWith('in:') || id.startsWith('miss:')) edges.push({ id: 'p|' + id, from: 'patient', to: id, type: id.startsWith('miss:') ? 'unknown' : 'confirmed', label: id.startsWith('miss:') ? 'missing' : 'has', ruleId: null, status: id.startsWith('miss:') ? 'unknown' : 'provided', headline: id.startsWith('miss:') ? 'Input not provided' : 'Provided by user', evidence: [], structural: true });
  }
  return { nodes: [...nodes.values()], edges };
}

const TYPE_TEXT = { confirmed: 'Confirmed (rule-backed)', unknown: 'Unknown / needs information', unverified: 'Unverified or citation pending' };

export function renderGraph(ds, getAnalysis, ui) {
  const svg = $('#kg'), detail = $('#graphDetail'), tbody = $('#graphTable tbody');
  const view = { scale: 1, tx: 0, ty: 0, selected: null };
  const mode = ($('input[name=graphMode]:checked') || { value: 'analysis' }).value;
  const model = buildGraphModel(ds, getAnalysis(), mode === 'analysis' ? 'analysis' : 'catalog');
  const q = ($('#graphSearch').value || '').toLowerCase();
  const typeOn = Object.fromEntries($$('.graph-filter').map(c => [c.dataset.type, c.checked]));
  let edges = model.edges.filter(e => typeOn[e.type] !== false);
  const used = new Set(edges.flatMap(e => [e.from, e.to]));
  let nodes = model.nodes.filter(n => used.has(n.id));
  if (q) { const match = new Set(nodes.filter(n => n.label.toLowerCase().includes(q)).map(n => n.id)); const keep = new Set(match); edges.forEach(e => { if (match.has(e.from)) keep.add(e.to); if (match.has(e.to)) keep.add(e.from); }); nodes = nodes.filter(n => keep.has(n.id)); edges = edges.filter(e => keep.has(e.from) && keep.has(e.to)); }

  clear(svg); clear(tbody);
  const ns = 'http://www.w3.org/2000/svg', el = (t, a = {}) => { const e = document.createElementNS(ns, t); for (const [k, v] of Object.entries(a)) e.setAttribute(k, v); return e; };
  const left = nodes.filter(n => n.kind !== 'drug' && n.kind !== 'patient').sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  const right = nodes.filter(n => n.kind === 'drug').sort((a, b) => a.label.localeCompare(b.label));
  const rows = Math.max(left.length, right.length, 1), H = rows * 34 + 60, hasPatient = nodes.some(n => n.kind === 'patient');
  svg.setAttribute('viewBox', `0 0 1000 ${H}`);
  const pos = {}; left.forEach((n, i) => { pos[n.id] = { x: hasPatient ? 300 : 260, y: 40 + i * (H - 60) / Math.max(left.length, 1) }; });
  right.forEach((n, i) => { pos[n.id] = { x: 760, y: 40 + i * (H - 60) / Math.max(right.length, 1) }; });
  if (hasPatient) pos.patient = { x: 70, y: H / 2 };
  const vp = el('g', { id: 'kgViewport' }); svg.append(vp);
  const apply = () => vp.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.scale})`);

  const select = (obj, isEdge) => { view.selected = obj.id; clear(detail);
    if (isEdge) detail.append(h('h4', { text: obj.headline }), h('p', {}, h('strong', { text: 'Relationship: ' }), TYPE_TEXT[obj.type], ` · label "${obj.label}"`), obj.ruleId ? h('p', { class: 'mono', text: `Rule: ${obj.ruleId}` }) : null, h('p', { text: 'Rule status: ' + statusText(obj.status) }),
      obj.evidence.length ? h('div', {}, obj.evidence.map(e => h('div', {}, safeLink(e.url, `${e.org}, ${e.year}: ${e.title}`)))) : h('p', { text: 'No evidence record linked to this relationship.' }));
    else { const rel = edges.filter(e => e.from === obj.id || e.to === obj.id); detail.append(h('h4', { text: obj.label }), h('p', { text: obj.detail }), h('p', { text: `${rel.length} relationship(s) shown:` }), h('ul', { class: 'plain' }, rel.map(e => h('li', { text: `${nodes.find(n => n.id === e.from)?.label} → ${nodes.find(n => n.id === e.to)?.label} (${TYPE_TEXT[e.type]})` })))); }
    detail.setAttribute('tabindex', '-1'); detail.focus(); };

  for (const e of edges) { const a = pos[e.from], b = pos[e.to]; if (!a || !b) continue;
    const p = el('path', { d: `M${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`, class: `edge edge-${e.type}`, fill: 'none', 'stroke-width': e.structural ? 1 : 2, tabindex: e.structural ? '-1' : '0', role: 'button', 'aria-label': `Relationship: ${nodes.find(n => n.id === e.from)?.label} to ${nodes.find(n => n.id === e.to)?.label}, ${TYPE_TEXT[e.type]}. Press Enter for evidence.` });
    const t = el('title'); t.textContent = `${e.headline} (${TYPE_TEXT[e.type]})`; p.append(t);
    p.addEventListener('click', () => select(e, true)); p.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); select(e, true); } });
    vp.append(p);
    tbody.append(h('tr', {}, h('td', { text: nodes.find(n => n.id === e.from)?.label }), h('td', { text: e.label }), h('td', { text: nodes.find(n => n.id === e.to)?.label }), h('td', { text: TYPE_TEXT[e.type] }), h('td', { class: 'mono', text: e.ruleId || '—' }), h('td', {}, e.evidence.length ? e.evidence.map(x => h('div', {}, safeLink(x.url, `${x.org} ${x.year}`))) : '—'))); }
  for (const n of nodes) { const p = pos[n.id]; if (!p) continue;
    const g = el('g', { class: `node node-${n.kind}`, tabindex: '0', role: 'button', 'aria-label': `${n.kind}: ${n.label}. Press Enter for details.` });
    g.append(el('circle', { cx: p.x, cy: p.y, r: n.kind === 'patient' ? 16 : 9 }));
    const tx = el('text', { x: n.kind === 'drug' ? p.x + 16 : n.kind === 'patient' ? p.x : p.x - 16, y: n.kind === 'patient' ? p.y + 30 : p.y + 4, 'text-anchor': n.kind === 'drug' ? 'start' : n.kind === 'patient' ? 'middle' : 'end', class: 'node-label' }); tx.textContent = n.label; g.append(tx);
    g.addEventListener('click', () => select(n, false)); g.addEventListener('keydown', (k) => { if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); select(n, false); } });
    vp.append(g); }
  if (!edges.length) { clear(detail); detail.append(h('p', { class: 'empty-state', text: mode === 'analysis' ? 'Run an analysis to see patient-specific relationships.' : 'No relationships match the current filters.' })); }
  $('#graphCount').textContent = `${nodes.length} nodes · ${edges.length} relationships`;

  // zoom / pan / reset (rebinding is safe: handlers are replaced each render)
  $('#zoomIn').onclick = () => { view.scale = Math.min(2.5, view.scale * 1.2); apply(); };
  $('#zoomOut').onclick = () => { view.scale = Math.max(0.5, view.scale / 1.2); apply(); };
  $('#zoomReset').onclick = () => { view.scale = 1; view.tx = 0; view.ty = 0; apply(); };
  let drag = null; svg.onmousedown = (e) => { if (e.target.closest && e.target.closest('.node,.edge')) return; drag = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }; };
  window.onmousemove = (e) => { if (!drag) return; view.tx = drag.tx + e.clientX - drag.x; view.ty = drag.ty + e.clientY - drag.y; apply(); }; window.onmouseup = () => { drag = null; };
  svg.onwheel = (e) => { e.preventDefault(); view.scale = Math.min(2.5, Math.max(0.5, view.scale * (e.deltaY > 0 ? 0.9 : 1.1))); apply(); };
  apply();
}
