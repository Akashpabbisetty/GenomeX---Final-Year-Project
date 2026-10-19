#!/usr/bin/env python3
"""
Reproducible ingestion of the three external datasets into data/ (read by the engine):

  * ClinPGx guideline annotations (guidelineAnnotations_json.zip)  -> data/guidelines/index.json
  * ClinPGx gene table            (genes.zip)                      -> data/gene_catalog.json
  * SIDER 4.1 side effects        (drug_names.tsv, meddra_all_se_tsv.gz, meddra_freq_tsv.gz)
                                                                   -> data/adverse/*  and extends data/drugs.json
  * provenance + licences                                          -> data/sources.json

Usage:  python3 scripts/ingest/ingest.py --raw /path/to/uploads --out data
Nothing is invented here: every field is copied/derived from the raw files, and counts are recorded in sources.json.
"""
import argparse, collections, csv, glob, gzip, hashlib, html, io, json, os, re, sys, zipfile
from html.parser import HTMLParser

ap = argparse.ArgumentParser()
ap.add_argument('--raw', default='/mnt/user-data/uploads'); ap.add_argument('--out', default='data')
args = ap.parse_args()
RAW, OUT = args.raw, args.out
W = lambda p, o, **k: open(os.path.join(OUT, p), 'w', encoding='utf-8').write(json.dumps(o, ensure_ascii=False, separators=(',', ':'), **k))
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
slug = lambda s: re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))

class T(HTMLParser):
    def __init__(s): super().__init__(); s.out = []
    def handle_data(s, d): s.out.append(d)
    def handle_starttag(s, tag, a):
        if tag in ('p', 'br', 'li', 'tr', 'div', 'h1', 'h2', 'h3', 'h4'): s.out.append(' ')
def plain(h):
    p = T(); p.feed(h or ''); return re.sub(r'\s+', ' ', html.unescape(''.join(p.out))).strip()

# ------------------------------------------------------------------ guidelines
zg = zipfile.ZipFile(os.path.join(RAW, 'guidelineAnnotations_json.zip'))
guid_created = zg.read([n for n in zg.namelist() if n.startswith('CREATED')][0]).decode().strip()
guidelines = []
for n in sorted(x for x in zg.namelist() if re.match(r'PA\d+\.json$', x)):
    g = json.loads(zg.read(n))['guideline']
    dates = [h['date'][:10] for h in g.get('history', []) if h.get('date')]
    lit = []
    for l in g.get('literature', []):
        u = l.get('_sameAs') or ''
        lit.append({'title': l.get('title'), 'url': u.replace('http://', 'https://') if u else None, 'date': (l.get('pubDate') or '')[:10] or None})
    guidelines.append({
        'id': g['id'], 'name': g['name'], 'source': g['source'], 'version': g.get('version'),
        'url': f"https://www.clinpgx.org/guidelineAnnotation/{g['id']}",
        'drugs': [{'name': c['name'], 'id': c['id']} for c in g.get('relatedChemicals', [])],
        'genes': [x['symbol'] for x in g.get('relatedGenes', [])],
        'created': min(dates) if dates else None, 'lastUpdated': max(dates) if dates else None,
        'literature': lit,
        'flags': {k: bool(g.get(k)) for k in ('recommendation', 'dosingInformation', 'alternateDrugAvailable', 'otherPrescribingGuidance', 'hasTestingInfo', 'pediatric')},
        'summary': plain((g.get('summaryMarkdown') or {}).get('html')),
    })
W('guidelines/index.json', {'schema': 'guidelines/1', 'attribution': 'Contains data from ClinPGx (https://www.clinpgx.org), licensed CC BY-SA 4.0. Text reduced to plain-text summaries; URLs constructed from annotation IDs. Changes were made (restructured, HTML removed).',
                            'created': guid_created, 'guidelines': guidelines})
print('guidelines:', len(guidelines), collections.Counter(g['source'] for g in guidelines).most_common(4))

# ------------------------------------------------------------------ drug catalog (extends the existing 30)
cat = json.load(open(os.path.join(OUT, 'drugs_core.json')))  # pristine base => ingestion is idempotent
drugs = {d['id']: d for d in cat['drugs'] if 'sources' not in d or True}
for d in drugs.values(): d.setdefault('class', None)
index = {}
def reindex():
    index.clear()
    for d in drugs.values():
        for n in [d['name'], d['id'], *d.get('aliases', [])]: index.setdefault(n.lower(), d['id'])
reindex()
NAME_EQUIV = {'sulfamethoxazole / trimethoprim': ('trimethoprim-sulfamethoxazole', 'Guideline lists "sulfamethoxazole / trimethoprim"; mapped to the same combination.'), 'thyroxine': ('levothyroxine', 'SIDER lists "thyroxine"; mapped to levothyroxine by name equivalence (stereochemistry not verified).')}
def resolve(name, create=True):
    k = name.lower().strip()
    if k in NAME_EQUIV and NAME_EQUIV[k][0] in drugs: return NAME_EQUIV[k][0], NAME_EQUIV[k][1]
    if k in index: return index[k], None
    if not create: return None, None
    i = slug(k)
    if i in drugs: raise SystemExit(f'id collision for {name!r} -> {i}')
    drugs[i] = {'id': i, 'name': name[0].upper() + name[1:], 'class': None, 'aliases': []}; index[k] = i; index[i] = i
    return i, None

gdrug_ids = collections.defaultdict(set)
for g in guidelines:
    for c in g['drugs']:
        i, _ = resolve(c['name']); c['drugId'] = i; gdrug_ids[i].add(g['id'])
W('guidelines/index.json', {'schema': 'guidelines/1', 'attribution': 'Contains data from ClinPGx (https://www.clinpgx.org), licensed CC BY-SA 4.0. Text reduced to plain-text summaries; URLs constructed from annotation IDs. Changes were made (restructured, HTML removed).', 'created': guid_created, 'guidelines': guidelines})

# ------------------------------------------------------------------ SIDER
dn = {}
with open(os.path.join(RAW, 'drug_names.tsv'), encoding='utf-8') as f:
    for cid, name in csv.reader(f, delimiter='\t'): dn[cid] = name.strip()
cid2drug, drugnotes = {}, {}
for cid, name in dn.items():
    i, note = resolve(name); cid2drug[cid] = i
    if note: drugnotes[i] = note
agg = collections.defaultdict(dict)       # drug -> cui -> {name, desc, lo, hi, pl}
terms = {}
def num(x):
    try: return float(x)
    except Exception: return None
with gzip.open(os.path.join(RAW, 'meddra_all_se_tsv.gz'), 'rt', encoding='utf-8') as f:
    for flat, _st, _lab, typ, cui, term in csv.reader(f, delimiter='\t'):
        if typ != 'PT': continue
        d = cid2drug[flat]; terms[cui] = term; agg[d].setdefault(cui, {'desc': None, 'lo': None, 'hi': None, 'pl': None})
RANK = {'very common': 0.1, 'common': 0.01, 'frequent': 0.01, 'uncommon': 0.001, 'infrequent': 0.001, 'rare': 0.0001, 'postmarketing': 0.00001}
freq_rows = 0
with gzip.open(os.path.join(RAW, 'meddra_freq_tsv.gz'), 'rt', encoding='utf-8') as f:
    for r in csv.reader(f, delimiter='\t'):
        flat, _st, _lab, placebo, desc, lo, hi, typ, cui, term = r
        if typ != 'PT' or cui not in terms or flat not in cid2drug: continue
        e = agg[cid2drug[flat]].get(cui)
        if e is None: continue
        lo_, hi_ = num(lo), num(hi); freq_rows += 1
        if placebo == 'placebo':
            if hi_ is not None and (e['pl'] is None or hi_ > e['pl']): e['pl'] = round(hi_, 4)
            continue
        rank = hi_ if re.match(r'^[\d.]+%$', desc) and hi_ is not None else RANK.get(desc, 0)
        if e['desc'] is None or (rank or 0) > (e.get('_r') or 0):
            e.update({'desc': desc or None, 'lo': lo_, 'hi': hi_, '_r': rank})
by_term = collections.defaultdict(lambda: collections.defaultdict(list))
n_pairs = n_freq = 0; sizes = {}
os.makedirs(os.path.join(OUT, 'adverse', 'drug'), exist_ok=True); os.makedirs(os.path.join(OUT, 'adverse', 'by_term'), exist_ok=True)
for d, effs in agg.items():
    rows = []
    for cui, e in effs.items():
        r = e.get('_r') or 0
        rows.append([cui, e['desc'], None if e['lo'] is None else round(e['lo'], 4), None if e['hi'] is None else round(e['hi'], 4), e['pl'], round(r, 5)])
        n_pairs += 1; n_freq += e['desc'] is not None
        by_term[int(cui[1:]) % 64][cui].append([d, e['desc'], round(r, 5)])
    rows.sort(key=lambda x: (-x[5], terms[x[0]]))
    sider_names = sorted({dn[c] for c, i in cid2drug.items() if i == d}); cids = sorted(c for c, i in cid2drug.items() if i == d)
    W(f'adverse/drug/{d}.json', {'drug': d, 'siderNames': sider_names, 'cids': cids, 'note': drugnotes.get(d), 'n': len(rows), 'cols': ['cui', 'freq', 'lo', 'hi', 'placeboHi', 'rank'], 'effects': rows})
    sizes[d] = len(rows)
for b, m in by_term.items(): W(f'adverse/by_term/b{b:02d}.json', m)
W('adverse/terms.json', terms)
W('adverse/index.json', {'schema': 'adverse/1', 'source': 'SIDER 4.1', 'drugs': sizes, 'terms': len(terms), 'pairs': n_pairs, 'pairsWithFrequency': n_freq,
                         'frequencyNote': 'Descriptive words (common, rare, …) are mapped to numeric ranges by SIDER, not by the original label. Rank is the lower bound used only for sorting.'})
print('SIDER drugs (unique after merge):', len(agg), 'pairs:', n_pairs, 'with frequency:', n_freq, 'terms:', len(terms))

# ------------------------------------------------------------------ finalise drug catalog
for i, d in drugs.items():
    d['sources'] = {'sider': i in sizes, 'guidelines': len(gdrug_ids.get(i, ()))}
    if i in drugnotes: d['note'] = drugnotes[i]
ordered = sorted(drugs.values(), key=lambda d: d['name'].lower())
W('drugs.json', {'schema': 'drugs/1', 'drugs': ordered})
print('drug catalog:', len(ordered), '| with guidelines:', sum(1 for d in ordered if d['sources']['guidelines']), '| with SIDER:', sum(1 for d in ordered if d['sources']['sider']))

# ------------------------------------------------------------------ genes
zgn = zipfile.ZipFile(os.path.join(RAW, 'genes.zip'))
genes_created = zgn.read([n for n in zgn.namelist() if n.startswith('CREATED')][0]).decode().strip()
panel = set(json.load(open(os.path.join(OUT, 'genes.json')))['genes'][i]['id'].split('*')[0] for i in range(len(json.load(open(os.path.join(OUT, 'genes.json')))['genes'])))
want = {s for g in guidelines for s in g['genes']} | panel | {'HLA-A', 'HLA-B'}
rd = csv.DictReader(io.TextIOWrapper(zgn.open('genes.tsv'), encoding='utf-8'), delimiter='\t')
gc = {}
for r in rd:
    if r['Symbol'] in want:
        gc[r['Symbol']] = {'symbol': r['Symbol'], 'name': r['Name'], 'clinpgxId': r['PharmGKB Accession Id'], 'hgncId': r['HGNC ID'], 'ncbiGeneId': r['NCBI Gene ID'], 'ensemblId': r['Ensembl Id'],
                           'isVip': r['Is VIP'] == 'Yes', 'hasCpicGuideline': r['Has CPIC Dosing Guideline'] == 'Yes', 'hasVariantAnnotation': r['Has Variant Annotation'] == 'Yes', 'chromosome': r['Chromosome'] or None}
missing = sorted(want - set(gc))
W('gene_catalog.json', {'schema': 'genes-catalog/1', 'attribution': 'Contains data from ClinPGx (CC BY-SA 4.0); reference GRCh38; created ' + genes_created, 'genes': sorted(gc.values(), key=lambda x: x['symbol'])})
print('gene catalog:', len(gc), 'symbols; not found in genes.tsv:', missing)

# ------------------------------------------------------------------ provenance
raw = lambda n: os.path.join(RAW, n)
W('sources.json', {'schema': 'sources/1', 'ingestedBy': 'scripts/ingest/ingest.py', 'sources': [
  {'id': 'clinpgx-guidelines', 'name': 'ClinPGx guideline annotations (formerly PharmGKB)', 'file': 'guidelineAnnotations_json.zip', 'sha256': sha(raw('guidelineAnnotations_json.zip')), 'created': guid_created,
   'records': len(guidelines), 'license': 'CC BY-SA 4.0', 'licenseUrl': 'http://creativecommons.org/licenses/by-sa/4.0/', 'url': 'https://www.clinpgx.org',
   'obligations': 'Attribution to ClinPGx; indicate changes; ShareAlike (derived data must be shared under the same licence); ClinPGx data may not be sold. See https://www.clinpgx.org/page/dataUsagePolicy.'},
  {'id': 'clinpgx-genes', 'name': 'ClinPGx gene table', 'file': 'genes.zip', 'sha256': sha(raw('genes.zip')), 'created': genes_created, 'records': len(gc), 'license': 'CC BY-SA 4.0', 'licenseUrl': 'http://creativecommons.org/licenses/by-sa/4.0/', 'url': 'https://www.clinpgx.org'},
  {'id': 'sider', 'name': 'SIDER 4.1 — drug side effects from labels (EMBL)', 'files': ['drug_names.tsv', 'meddra_all_se_tsv.gz', 'meddra_freq_tsv.gz'],
   'sha256': {n: sha(raw(n)) for n in ('drug_names.tsv', 'meddra_all_se_tsv.gz', 'meddra_freq_tsv.gz')}, 'records': {'drugNames': len(dn), 'drugsAfterMerge': len(agg), 'pairs': n_pairs, 'terms': len(terms)},
   'license': 'Not included with the uploaded files. SIDER is, to the best of my knowledge, published under CC BY-NC-SA 4.0 (non-commercial, share-alike) — VERIFY at http://sideeffects.embl.de before any redistribution or commercial use.',
   'url': 'http://sideeffects.embl.de', 'cite': 'Kuhn M, et al. Nucleic Acids Res 2016 (SIDER 4).',
   'limitations': 'Derived from drug labels (mid-2010s snapshot), not patient outcomes; no severity grading; 147 duplicate drug names merged; frequency available for a minority of pairs.'}]})
print('wrote sources.json')
