#!/usr/bin/env python3
"""
Open TG-GATEs ingestion -> data/tggates/  (drug-level PRECLINICAL liver-toxicity context; never patient-level).

Inputs : Open-tggates_AllAttribute.zip (Shift-JIS TSV, 33,566 array records) and optionally alpidem_Human_in_vitro_Liver.zip.
Method : * one row per ARRAY, but blood chemistry is per ANIMAL -> de-duplicate on (EXP_ID, GROUP_ID, INDIVIDUAL_ID);
         * each treated group (Low/Middle/High) is compared with the CONCURRENT Control of the same experiment and sacrifice time;
         * endpoints: ALT, AST, ALP, gamma-GTP, total bilirubin, relative liver weight;
         * fold = mean(treated)/mean(control); p = two-sided Mann-Whitney U (exploratory, uncorrected, n usually 5 v 5);
         * flag = fold >= 2 AND complete separation (every treated value above every control value).
         Per-endpoint valid n (nt, nc) is stored: some animals lack individual measurements (e.g. liver weight).
Every one of the 170 compounds MUST be classified (mapped / curated drug / excluded non-drug) or the script aborts.
"""
import argparse, collections, hashlib, io, json, math, os, re, sys, zipfile
import numpy as np, pandas as pd
from scipy.stats import mannwhitneyu

ap = argparse.ArgumentParser(); ap.add_argument('--raw', default='/mnt/user-data/uploads'); ap.add_argument('--out', default='data'); a = ap.parse_args()
OUT = os.path.join(a.out, 'tggates'); os.makedirs(os.path.join(OUT, 'compound'), exist_ok=True)
sha = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
W = lambda p, o: open(os.path.join(OUT, p), 'w', encoding='utf-8').write(json.dumps(o, ensure_ascii=False, separators=(',', ':')))

z = zipfile.ZipFile(os.path.join(a.raw, 'Open-tggates_AllAttribute.zip'))
df = pd.read_csv(io.BytesIO(z.read('Open-tggates_AllAttribute.tsv')), sep='\t', encoding='cp932', low_memory=False)
print('records:', len(df), 'compounds:', df.COMPOUND_NAME.nunique())

# ------------------------------------------------------------- compound -> catalog drug
drugs = json.load(open(os.path.join(a.out, 'drugs.json')))['drugs']; byid = {d['id']: d for d in drugs}
index = {}
for d in drugs:
    for n in [d['name'], d['id'], *d.get('aliases', [])]: index.setdefault(n.lower(), d['id'])
SALTS = {'hydrochloride', 'maleate', 'acetate', 'ethylsuccinate', 'sodium', 'mesylate', 'methanesulfonate', 'salt'}
def strip_salt(n): return ' '.join(w for w in re.split(r'[ ,]+', n.lower()) if w and w not in SALTS)
SYNONYM = {  # vetted name equivalences (documented in sources/tggates notes; each target must exist in the catalog)
  'valproic acid': ('valproate', 'valproic acid ≈ valproate (same active moiety)'), 'penicillamine': ('d-penicillamine', 'penicillamine = D-penicillamine'),
  'amphotericin b': ('amphotericin', 'name variant'), 'mefenamic acid': ('mefenamic', 'name variant'), 'adapin': ('doxepin', 'Adapin is a doxepin brand name'),
}
CURATED = {x['id']: x for x in json.load(open(os.path.join(a.out, 'drugs_curated_additions.json')))['drugs']}
CURATED_BY_NAME = {x['name'].lower(): x['id'] for x in CURATED.values()}
EXCLUDED = {  # not medicinal products: research toxicants, biologic reagents, diets/vehicles. (curation judgement; reasons recorded)
 **{n: 'research toxicant / chemical' for n in ['2,4-dinitrophenol', '2-nitrofluorene', '3-methylcholanthrene', 'N-methyl-N-nitrosourea', 'N-nitrosomorpholine', 'WY-14643', 'acetamide', 'acetamidofluorene', 'aflatoxin B1',
   'allyl alcohol', 'bromobenzene', 'bromoethylamine', 'buthionine sulfoximine', 'butylated hydroxyanisole', 'carbon tetrachloride', 'cycloheximide', 'diethyl maleate', 'ethanol', 'ethionine', 'galactosamine',
   'hexachlorobenzene', 'methylene dianiline', 'monocrotaline', 'naphthyl isothiocyanate', 'nitrosodiethylamine', 'phalloidin', 'phorone', 'puromycin aminonucleoside', 'rotenone', 'tannic acid', 'thioacetamide',
   'tunicamycin', 'coumarin', 'phenylanthranilic acid', 'vitamin A']},
 **{n: 'biologic / cytokine reagent' for n in ['LPS', 'TNFα', 'hepatocyte growth factor, human', 'interferon alpha, human', 'interleukin 1 beta, human', 'interleukin 6, human', 'transforming growth factor beta 1']},
 '1% cholesterol + 0.25% sodium cholate': 'diet / vehicle',
}
mapping, notes = {}, {}
for c in sorted(df.COMPOUND_NAME.dropna().unique()):
    k = c.lower()
    if k in index and byid[index[k]].get('curated'): mapping[c] = (index[k], 'curated-addition', 'added to the catalog by hand as a medicinal product')
    elif k in index: mapping[c] = (index[k], 'exact', None)
    elif strip_salt(c) in index: mapping[c] = (index[strip_salt(c)], 'salt-form', f'{c} -> {strip_salt(c)}')
    elif k in SYNONYM:
        t, why = SYNONYM[k]; assert t in byid, t; mapping[c] = (t, 'synonym', why)
    elif k in CURATED_BY_NAME: mapping[c] = (CURATED_BY_NAME[k], 'curated-addition', 'added to the catalog by hand as a medicinal product')
    elif c in EXCLUDED: pass
    else: sys.exit(f'UNCLASSIFIED compound: {c!r} — classify it explicitly')
unclassified = [c for c in df.COMPOUND_NAME.dropna().unique() if c not in mapping and c not in EXCLUDED]; assert not unclassified, unclassified
print('mapped', len(mapping), '| excluded', len([c for c in EXCLUDED if c in set(df.COMPOUND_NAME)]))
dup = collections.Counter(v[0] for v in mapping.values()); assert all(n == 1 for n in dup.values()), [k for k, n in dup.items() if n > 1]   # two compounds mapped to one drug would merge studies silently

# ------------------------------------------------------------- statistics
iv = df[df.TEST_TYPE == 'in vivo'].copy()
animals = iv.drop_duplicates(['EXP_ID', 'GROUP_ID', 'INDIVIDUAL_ID']).copy()
animals['LIVER_REL'] = animals['LIVER(g)'] / animals['TERMINAL_BW(g)'] * 100
EP = {'ALT': 'ALT(IU/L)', 'AST': 'AST(IU/L)', 'ALP': 'ALP(IU/L)', 'GGT': 'GTP(IU/L)', 'TBIL': 'TBIL(mg/dL)', 'LIVER_REL': 'LIVER_REL'}
ORDER = {'3 hr': 0, '6 hr': 1, '9 hr': 2, '24 hr': 3, '4 day': 4, '8 day': 5, '15 day': 6, '29 day': 7}
LEVEL = {'Low': 0, 'Middle': 1, 'High': 2}
def stats(t, c):
    t, c = t.dropna().to_numpy(float), c.dropna().to_numpy(float)
    if len(t) < 3 or len(c) < 3 or np.mean(c) <= 0: return None
    fold = float(np.mean(t) / np.mean(c))
    p = float(mannwhitneyu(t, c, alternative='two-sided', method='auto').pvalue)
    return {'nt': int(len(t)), 'nc': int(len(c)), 'fold': round(fold, 3), 'p': round(p, 4), 'sep': bool(t.min() > c.max()), 'cm': float(f'{np.mean(c):.6g}'), 'tm': float(f'{np.mean(t):.6g}')}
cinfo = {}; invitro = df[df.TEST_TYPE == 'in vitro']
for comp, (drug, how, note) in mapping.items():
    sub = animals[animals.COMPOUND_NAME == comp]; groups = []
    for (exp, typ, per), g in sub.groupby(['EXP_ID', 'SIN_REP_TYPE', 'SACRI_PERIOD']):
        ctrl = g[g.DOSE_LEVEL == 'Control']
        for lvl in ('Low', 'Middle', 'High'):
            t = g[g.DOSE_LEVEL == lvl]
            if t.empty or ctrl.empty: continue
            ep = {}
            for k, col in EP.items():
                s = stats(t[col], ctrl[col])
                if s: ep[k] = s
            groups.append({'exp': int(exp), 'type': typ, 'period': per, 'level': lvl, 'dose': float(t.DOSE.iloc[0]), 'unit': t.DOSE_UNIT.iloc[0], 'route': t.ADM_ROUTE_TYPE.iloc[0], 'nT': int(len(t)), 'nC': int(len(ctrl)), 'ep': ep})
    groups.sort(key=lambda x: (x['type'], ORDER.get(x['period'], 9), LEVEL[x['level']]))
    flags = [(g, e, v) for g in groups for e, v in g['ep'].items() if e in ('ALT', 'AST') and v['fold'] >= 2 and v['sep']]
    best = lambda e: max(((v['fold'], g['level'], g['period'], g['type']) for g in groups for k, v in g['ep'].items() if k == e), default=None)
    iv_c = invitro[invitro.COMPOUND_NAME == comp]
    vit = {sp: {'arrays': int(len(x)), 'doses': sorted({f"{d:g} {u}" for d, u in zip(x.DOSE, x.DOSE_UNIT)})[:6], 'periods': sorted(x.SACRI_PERIOD.dropna().unique())} for sp, x in iv_c.groupby('SPECIES')}
    out = {'drug': drug, 'compound': comp, 'abbr': sub['COMPOUND Abbr.'].iloc[0] if len(sub) else None, 'match': how, 'matchNote': note,
           'animals': int(len(sub)), 'routes': sorted(sub.ADM_ROUTE_TYPE.dropna().unique()), 'groups': groups, 'inVitro': vit,
           'summary': {'liverEnzymeSignal': bool(flags), 'nFlaggedGroups': len(flags), 'maxALT': best('ALT'), 'maxAST': best('AST'), 'maxALP': best('ALP'), 'maxTBIL': best('TBIL')}}
    W(f'compound/{drug}.json', out)
    cinfo[drug] = {'compound': comp, 'match': how, 'inVivo': bool(groups), 'animals': out['animals'], 'liverEnzymeSignal': out['summary']['liverEnzymeSignal'], 'nFlaggedGroups': out['summary']['nFlaggedGroups'], 'maxALTfold': (best('ALT') or [None])[0], 'maxASTfold': (best('AST') or [None])[0],
                   'inVitroHuman': vit.get('Human', {}).get('arrays', 0), 'inVitroRat': vit.get('Rat', {}).get('arrays', 0)}
W('index.json', {'schema': 'tggates/1', 'compounds': cinfo, 'excluded': [{'compound': c, 'reason': r} for c, r in sorted(EXCLUDED.items()) if c in set(df.COMPOUND_NAME)],
  'method': 'Per-animal de-duplicated; treated vs concurrent control (same EXP_ID, sacrifice time); fold of means; two-sided Mann-Whitney U (exploratory, uncorrected); flag = fold>=2 and complete separation (ALT or AST).',
  'liverTermCuis': ['C0151904', 'C0151905', 'C0438717', 'C0235996', 'C0438237', 'C0855619', 'C0151766', 'C0086565', 'C0860207', 'C0235378', 'C0151763', 'C0160390', 'C0019193', 'C0151798', 'C1735647', 'C0162557', 'C0085605', 'C0023895', 'C0008370', 'C2242582', 'C0022354', 'C0311468', 'C0020433', 'C0022346'],
  'attribution': 'Contains data from Open TG-GATEs (Toxicogenomics Project / NIBIOHN). Licence believed to be CC BY-SA (verify at https://dbarchive.biosciencedbc.jp/en/open-tggates/). Citation as recalled: Igarashi Y et al., Nucleic Acids Res 2015;43:D921-7 (doi:10.1093/nar/gku955) — verify.',
  'limitations': 'Rat (Crj:CD(SD)IGS, mostly male, n≈5/group) and in-vitro data; doses far above therapeutic; blood chemistry only (no histopathology in the provided table); not human evidence; no gene-expression summarisation (CEL files unprocessed).',
  'sha256': sha(os.path.join(a.raw, 'Open-tggates_AllAttribute.zip')), 'records': int(len(df)), 'animals': int(len(animals))})
print('compounds with in vivo groups:', sum(v['inVivo'] for v in cinfo.values()), '| with ALT/AST signal flag:', sum(v['liverEnzymeSignal'] for v in cinfo.values()))

# ---- provenance entry in sources.json (replaces any previous tggates entry) ----
sp = os.path.join(a.out, 'sources.json'); src = json.load(open(sp)); src['sources'] = [x for x in src['sources'] if x['id'] != 'tggates']
src['sources'].insert(0, {'id': 'tggates', 'name': 'Open TG-GATEs (toxicogenomics; rat in vivo blood chemistry, in vitro array inventory)', 'file': 'Open-tggates_AllAttribute.zip', 'sha256': sha(os.path.join(a.raw, 'Open-tggates_AllAttribute.zip')),
  'records': {'arrayRecords': int(len(df)), 'animals': int(len(animals)), 'compounds': int(df.COMPOUND_NAME.nunique()), 'mappedToCatalog': len(mapping), 'excluded': len([c for c in EXCLUDED if c in set(df.COMPOUND_NAME)])},
  'license': 'Believed CC BY-SA (NBDC); not included with the upload — VERIFY at https://dbarchive.biosciencedbc.jp/en/open-tggates/', 'url': 'https://dbarchive.biosciencedbc.jp/en/open-tggates/',
  'limitations': 'Preclinical rat data at high doses; blood chemistry only (no histopathology); CEL expression files are NOT processed (no probeset annotation available).'})
json.dump(src, open(sp, 'w'), ensure_ascii=False, separators=(',', ':')); print('sources.json updated')
