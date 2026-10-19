The project is packaged for Kiro as `genomx_v2_2_kiro.zip`. It passes all 160 tests, but it has not been viewed in a real browser. The packaging was cut off mid-reply, so the zip is already attached above.

## What I did with your latest files

- **Open TG-GATEs** is now a preclinical liver-toxicity layer. It covers 127 compounds from the rat data. I re-derived 3,000 of the stored statistics from the raw file and found no mismatches. It also caught a bug: some animals lack individual measurements, so the group size was misleading (4 of 10 animals had a liver weight). That is fixed.
- **TG-GATEs limit:** acetaminophen, diclofenac, isoniazid and ketoconazole are _not_ flagged by the rat criterion. The UI says "no flag is not reassurance".
- **Ensembl dumps** still have no rows (schema only), so they remain unusable.
- **The CEL files** can't give gene-level data without a probe-to-gene annotation file.
- **Your `app.js` and `clinical_rules.py`** are the original prototype with the same "severity floor" fix I'd already made. They add one unsourced cephalexin–kidney rule, which I did not encode.

## The plan

**Your methodology document is partly out of date, and `docs/HANDOFF.md` lists the fixes.**

- It still describes the 0–100 score and the 48 interaction pairs, both removed as unsourced.
- Its 7 papers and their links came from another assistant. I verified none of them, so open each before citing.

**Without a cohort that has both genotypes and outcomes, patient-level ADR prediction is not possible.** I'd make the paper's main experiment drug-to-adverse-effect association prediction on a knowledge graph:

- **Data:** your SIDER, ClinPGx and TG-GATEs data, which are real and in hand.
- **Evaluation:** hold out whole drugs, compare against simple baselines, and report ablations with confidence intervals.
- **Supporting experiments:** (a) the rule engine against CPIC's own recommendation tables, and (b) the TG-GATEs rat signal against human liver-injury labels from FDA DILIrank.

The roadmap runs about 14 weeks, with a data checklist and risks.

## Using it in Kiro

1. Open the folder and read `START_HERE.md`, then `docs/HANDOFF.md`.
2. The `.kiro/steering/` files carry the rules that must survive the move: no score, missing data is never normal, and only cited rules can say avoid or modify.
3. There are four specs with requirements, design and tasks. Do `kg-adr-prediction` first, then `rule-coverage` and `patient-api-integration`, with `research-paper` running alongside.
4. Put your raw downloads in `data_raw/`. They aren't in the zip, and the ingest scripts rebuild everything from them.
5. Of my three earlier zips, only this one matters now.

## Open items

- **Browser check:** layout, mobile and screen readers are untested; the Kiro tasks include Playwright tests for it.
- **Licenses:** ClinPGx is share-alike and non-sale. The SIDER and TG-GATEs licenses weren't in your files and must be verified. Keep the project non-commercial for now.
- **Unfinished pieces:** the interaction module has no data, and 194 drugs have only guideline pointers instead of encoded rules.
- **Model scores:** the old ML models are not connected to the app. The model-score panel is a task in the integration spec, and it keeps model output separate from the rules.
