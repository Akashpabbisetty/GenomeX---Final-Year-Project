# Rule Coverage Additions: FEAT-001, FEAT-002, FEAT-003

This document records all pharmacogenomic (PGx) rules added to the GenomX rule engine across three feature expansions. All rules carry `status: "verified"`, `evidenceLevel: null`, and no numeric safety score or probability field.

---

## Summary

| Feature | Drug families | Rules added | Evidence records added | Reference cases added |
|---------|---------------|-------------|------------------------|-----------------------|
| FEAT-001 | Tricyclic antidepressants (TCAs), SSRIs | 19 | 2 (E-CPIC-TCA-2017, E-CPIC-SSRI-2023) | 20 |
| FEAT-002 | Tacrolimus, Warfarin (multi-gene), Tamoxifen, PPIs, Voriconazole, Irinotecan | 11 | 5 (E-CPIC-TACROLIMUS-2015, E-CPIC-WARFARIN-2017, E-CPIC-TAMOXIFEN-2018, E-CPIC-PPI-2021, E-CPIC-VORI-2017) | 19 |
| FEAT-003 | G6PD-deficiency drugs (8 drugs) | 8 | 1 (E-CPIC-G6PD-2023) | 10 |
| **Total** | **19 drugs** | **38** | **8** | **49** |

Also fixed in FEAT-001: Windows path bug in `tests/helpers.js` (`fileURLToPath` replaces `.pathname`) and same fix in `scripts/validate-data.mjs`, which had blocked all test runs on Windows.

---

## FEAT-001: Tricyclic Antidepressants and SSRIs

### Evidence records

| ID | Source | Year |
|----|--------|------|
| E-CPIC-TCA-2017 | CPIC Guideline for CYP2D6 and CYP2C19 and Tricyclic Antidepressants (2016 update) — PMC5478479 | 2017 |
| E-CPIC-SSRI-2023 | CPIC Guideline for CYP2D6, CYP2C19, CYP2B6, SLC6A4, and HTR2A and Serotonin Reuptake Inhibitors — PMC10564324 | 2023 |

### Rules added

#### Amitriptyline (drug: `amitriptyline`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-AMITRIPTYLINE-CYP2D6-UMPM | CYP2D6 | ultrarapid, poor | modify | E-CPIC-TCA-2017, G:PA166105006, G:PA166104982 |
| R-PGX-AMITRIPTYLINE-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TCA-2017, G:PA166105006, G:PA166104982 |
| R-PGX-AMITRIPTYLINE-CYP2C19-UMRPM | CYP2C19 | ultrarapid, rapid, poor | modify | E-CPIC-TCA-2017, G:PA166105006 |

#### Nortriptyline (drug: `nortriptyline`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-NORTRIPTYLINE-CYP2D6-UMPM | CYP2D6 | ultrarapid, poor | modify | E-CPIC-TCA-2017, G:PA166104998, G:PA166104961 |
| R-PGX-NORTRIPTYLINE-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TCA-2017, G:PA166104998, G:PA166104961 |

#### Clomipramine (drug: `clomipramine`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-CLOMIPRAMINE-CYP2D6-UMPM | CYP2D6 | ultrarapid, poor | modify | E-CPIC-TCA-2017, G:PA166105007, G:PA166104964 |
| R-PGX-CLOMIPRAMINE-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TCA-2017, G:PA166105007, G:PA166104964 |
| R-PGX-CLOMIPRAMINE-CYP2C19-UM | CYP2C19 | ultrarapid | modify | E-CPIC-TCA-2017, G:PA166105007, G:PA166184528 |

Note: DPWG (PA166184528) recommends avoidance for OCD/depression; encoded as `modify` because indication cannot be confirmed from available inputs.

#### Desipramine (drug: `desipramine`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-DESIPRAMINE-CYP2D6-UMPM | CYP2D6 | ultrarapid, poor | modify | E-CPIC-TCA-2017, G:PA166105002 |
| R-PGX-DESIPRAMINE-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TCA-2017, G:PA166105002 |

#### Imipramine (drug: `imipramine`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-IMIPRAMINE-CYP2D6-UMPM | CYP2D6 | ultrarapid, poor | modify | E-CPIC-TCA-2017, G:PA166104999, G:PA166104972 |
| R-PGX-IMIPRAMINE-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TCA-2017, G:PA166104999, G:PA166104972 |
| R-PGX-IMIPRAMINE-CYP2C19-PM | CYP2C19 | poor | modify | E-CPIC-TCA-2017, G:PA166104999, G:PA166104954 |

#### Citalopram (drug: `citalopram`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-CITALOPRAM-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-SSRI-2023, G:PA166127638, G:PA166104977 |
| R-PGX-CITALOPRAM-CYP2C19-IMPM | CYP2C19 | intermediate, poor | modify | E-CPIC-SSRI-2023, G:PA166127638, G:PA166104977 |

#### Escitalopram (drug: `escitalopram`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-ESCITALOPRAM-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-SSRI-2023, G:PA166127638, G:PA166104975 |
| R-PGX-ESCITALOPRAM-CYP2C19-IMPM | CYP2C19 | intermediate, poor | modify | E-CPIC-SSRI-2023, G:PA166127638, G:PA166104975 |

#### Sertraline (drug: `sertraline`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-SERTRALINE-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-SSRI-2023, G:PA166127639, G:PA166104980 |
| R-PGX-SERTRALINE-CYP2C19-PM | CYP2C19 | poor | modify | E-CPIC-SSRI-2023, G:PA166127639, G:PA166104980 |

---

## FEAT-002: Tacrolimus, Warfarin, Tamoxifen, PPIs, Voriconazole, Irinotecan

### Evidence records

| ID | Source | Year |
|----|--------|------|
| E-CPIC-TACROLIMUS-2015 | CPIC Guideline for CYP3A5 and Tacrolimus — PMC4481158 | 2015 |
| E-CPIC-WARFARIN-2017 | CPIC Guideline for Pharmacogenetics-Guided Warfarin Dosing (2017 update) — PMC5546947 | 2017 |
| E-CPIC-TAMOXIFEN-2018 | CPIC Guideline for CYP2D6 and Tamoxifen — PMC5931215 | 2018 |
| E-CPIC-PPI-2021 | CPIC Guideline for CYP2C19 and Proton Pump Inhibitor Dosing — PMC7868475 | 2021 |
| E-CPIC-VORI-2017 | CPIC Guidelines for CYP2C19 and Voriconazole Therapy — PMC5474211 | 2017 |

### Rules added

#### Tacrolimus (drug: `tacrolimus`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-TACROLIMUS-CYP3A5-EXPRESSER | CYP3A5 | normal, intermediate | modify | E-CPIC-TACROLIMUS-2015, G:PA166124619, G:PA166104983, G:PA166202481 |

#### Warfarin (drug: `warfarin`)

Multi-gene dosing: CYP2C9, VKORC1, and CYP4F2. Full pharmacogenomics-guided dose algorithm requires all three gene inputs.

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-WARFARIN-CYP2C9-IMPM | CYP2C9 | intermediate, poor | modify | E-CPIC-WARFARIN-2017, G:PA166104949, G:PA166182842 |
| R-PGX-WARFARIN-VKORC1-VARIANT | VKORC1 | variant_present | modify | E-CPIC-WARFARIN-2017, G:PA166104949, G:PA166182841 |
| R-PGX-WARFARIN-CYP4F2-VARIANT | CYP4F2 | variant_present | modify | E-CPIC-WARFARIN-2017, G:PA166104949 |

#### Tamoxifen (drug: `tamoxifen`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-TAMOXIFEN-CYP2D6-PM | CYP2D6 | poor | modify | E-CPIC-TAMOXIFEN-2018, G:PA166176068, G:PA166104966 |
| R-PGX-TAMOXIFEN-CYP2D6-IM | CYP2D6 | intermediate | modify | E-CPIC-TAMOXIFEN-2018, G:PA166176068, G:PA166104966 |

#### Omeprazole (drug: `omeprazole`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-OMEPRAZOLE-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-PPI-2021, G:PA166219103, G:PA166104957 |

#### Lansoprazole (drug: `lansoprazole`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-LANSOPRAZOLE-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-PPI-2021, G:PA166219103, G:PA166104987 |

#### Voriconazole (drug: `voriconazole`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-VORICONAZOLE-CYP2C19-UM | CYP2C19 | ultrarapid, rapid | modify | E-CPIC-VORI-2017, G:PA166161537, G:PA166104990, G:PA166257241 |
| R-PGX-VORICONAZOLE-CYP2C19-PM | CYP2C19 | poor | modify | E-CPIC-VORI-2017, G:PA166161537, G:PA166104990 |

**CPIC primary recommendation for PM:** Select an alternative antifungal not dependent on CYP2C19; DPWG's 50% dose-reduction is encoded as a secondary path. Both guidelines are cited in the evidence array.

#### Irinotecan (drug: `irinotecan`)

| Rule ID | Gene | Phenotype(s) | Action | Key citations |
|---------|------|--------------|--------|---------------|
| R-PGX-IRINOTECAN-UGT1A1-PM | UGT1A1 | poor | modify | G:PA166104951, G:PA166127626, G:PA166312821 |

---

## FEAT-003: G6PD-Deficiency Drugs

### Evidence records

| ID | Source | Year |
|----|--------|------|
| E-CPIC-G6PD-2023 | Expanded CPIC Guideline for Medication Use in the Context of G6PD Genotype — PMC10281211 | 2023 |

### Rules added

All eight rules carry `action: "avoid"` and `strength: "strong"`. The G6PD primaquine-specific annotation (G:PA166279621) is cited for primaquine rules only; G:PA166119846 covers dapsone, methylene blue, pegloticase, rasburicase, tafenoquine, and toluidine blue. PA166119846 does not cover primaquine and is therefore not cited on primaquine rules.

| Rule ID | Drug | Gene | Phenotype(s) | Action | Key citations |
|---------|------|------|--------------|--------|---------------|
| R-PGX-DAPSONE-G6PD-DEFICIENT | dapsone | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-METHYLENE-BLUE-G6PD-DEFICIENT | methylene-blue | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-PEGLOTICASE-G6PD-DEFICIENT | pegloticase | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-RASBURICASE-G6PD-DEFICIENT | rasburicase | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-TAFENOQUINE-G6PD-DEFICIENT | tafenoquine | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-TOLUIDINE-BLUE-G6PD-DEFICIENT | toluidine-blue | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166119846 |
| R-PGX-PRIMAQUINE-G6PD-DEFICIENT | primaquine | G6PD | deficient | avoid | E-CPIC-G6PD-2023, G:PA166279621 |
| R-PGX-PRIMAQUINE-G6PD-VARIABLE | primaquine | G6PD | variable | conditional | E-CPIC-G6PD-2023, G:PA166279621 |

---

## Known Gaps

The following areas were out of scope for FEAT-001 through FEAT-003 or could not be encoded without additional information. Each is documented in the relevant rule's `limitations[]` field.

### Omeprazole and Lansoprazole PM/IM

CYP2C19 poor metabolizer and intermediate metabolizer rules are not encoded for omeprazole (`G:PA166104957`) or lansoprazole (`G:PA166104987`). Only the UM/rapid rules are present. The DPWG PM/IM summaries for these drugs were not fully available from the index at encoding time.

### UGT1A1 Intermediate Metabolizer (Irinotecan)

The irinotecan rule covers only UGT1A1 poor metabolizers (`*28/*28`). Dose adjustment guidance for UGT1A1 intermediate metabolizers (`*28/*1`) varies across guidelines (DPWG G:PA166104951, RNPGx G:PA166127626) and was not encoded in this version.

### Voriconazole PM vs CPIC Recommendation — Resolved

`R-PGX-VORICONAZOLE-CYP2C19-PM` has been updated (version 2.1.0) to reflect CPIC's primary recommendation: select an alternative antifungal agent not dependent on CYP2C19 for adult poor metabolizers. DPWG's 50% dose-reduction is noted as a secondary path in the rationale and alternatives text. Both `G:PA166161537` (CPIC) and `G:PA166104990` (DPWG) remain in the evidence array.

### Clomipramine CYP2C19 UM — Indication-Dependent Avoidance

DPWG (G:PA166184528) recommends avoidance of clomipramine for CYP2C19 UM patients in OCD/depression indications. `R-PGX-CLOMIPRAMINE-CYP2C19-UM` encodes `action: "modify"` because the engine cannot distinguish OCD from other indications from current inputs. This is a deliberate conservative choice documented in the rule's `limitations[]`.

---

## Pre-existing Rules Not Modified

The following rules were present before FEAT-001 and were not changed in this work stream:

- HLA-B*57:01/abacavir, HLA-B*58:01/allopurinol, HLA-B*15:02+HLA-A*31:01/carbamazepine, HLA-B*15:02/oxcarbazepine
- CYP2D6/codeine (UM and PM), CYP2C19/clopidogrel (CV and neurovascular), TPMT+NUDT15/thiopurines
- DPYD/fluorouracil and capecitabine, SLCO1B1/simvastatin and atorvastatin
- eGFR/metformin (FDA DSC), FDA DSC/codeine age/breastfeeding rules

---

*Generated: 2026-10-20. Test run result: 213 tests passed, 0 failed. `npm run validate-data` exit 0.*
