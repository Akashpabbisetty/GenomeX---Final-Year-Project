#!/usr/bin/env python3
"""Independent re-verification of data/tggates/* against the RAW TG-GATEs table (not importing the ingest code):
recomputes fold-changes / group sizes for a random sample of stored groups with plain pandas. Usage: python3 scripts/verify_tggates.py --raw <uploads> --n 300"""
import argparse, glob, io, json, os, random, zipfile
import numpy as np, pandas as pd
ap = argparse.ArgumentParser(); ap.add_argument('--raw', default='/mnt/user-data/uploads'); ap.add_argument('--data', default='data'); ap.add_argument('--n', type=int, default=300); a = ap.parse_args()
df = pd.read_csv(io.BytesIO(zipfile.ZipFile(os.path.join(a.raw, 'Open-tggates_AllAttribute.zip')).read('Open-tggates_AllAttribute.tsv')), sep='\t', encoding='cp932', low_memory=False)
iv = df[df.TEST_TYPE == 'in vivo'].drop_duplicates(['EXP_ID', 'GROUP_ID', 'INDIVIDUAL_ID']).copy(); iv['LIVER_REL'] = iv['LIVER(g)'] / iv['TERMINAL_BW(g)'] * 100
COL = {'ALT': 'ALT(IU/L)', 'AST': 'AST(IU/L)', 'ALP': 'ALP(IU/L)', 'GGT': 'GTP(IU/L)', 'TBIL': 'TBIL(mg/dL)', 'LIVER_REL': 'LIVER_REL'}
rows = []
for f in glob.glob(os.path.join(a.data, 'tggates/compound/*.json')):
    c = json.load(open(f))
    for g in c['groups']:
        for ep, s in g['ep'].items(): rows.append((c['compound'], g, ep, s))
random.seed(1); sample = random.sample(rows, min(a.n, len(rows))); worst = 0; bad = 0
for comp, g, ep, s in sample:
    d = iv[(iv.COMPOUND_NAME == comp) & (iv.EXP_ID == g['exp']) & (iv.SIN_REP_TYPE == g['type']) & (iv.SACRI_PERIOD == g['period'])]
    t = d[d.DOSE_LEVEL == g['level']][COL[ep]].dropna().astype(float); c = d[d.DOSE_LEVEL == 'Control'][COL[ep]].dropna().astype(float)
    fold = t.mean() / c.mean(); err = abs(fold - s['fold']); worst = max(worst, err)
    ok = err < 0.002 and len(t) == s['nt'] and len(c) == s['nc'] and bool(t.min() > c.max()) == s['sep']
    bad += not ok
    if not ok: print('MISMATCH', comp, g['type'], g['period'], g['level'], ep, s['fold'], round(fold, 3))
print(f'checked {len(sample)} stored group-endpoint stats against the raw table: mismatches={bad}, worst |fold diff|={worst:.4f}')
