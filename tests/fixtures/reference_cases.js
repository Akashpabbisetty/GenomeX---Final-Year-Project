// Reference cases. `expected` is the action category that the CITED SOURCE implies for the stated input.
// IMPORTANT LIMITATION: the same sources were used to author the rules, so passing these cases shows the
// rules faithfully encode the sources (a regression check) — it is NOT independent clinical validation.
export const NOW = new Date('2026-10-13T00:00:00Z');
export const BASE = { age: 40, breastfeeding: 'not_applicable', indication: 'unknown', allergyHistoryStatus: 'none_known', egfrValue: '90', egfrDate: '2026-09-01' };
export const geno = (o) => Object.fromEntries(Object.entries(o).map(([g, ph]) => [g, { status: 'result_available', phenotype: ph }]));
const P = (extra = {}, genes = {}) => ({ ...BASE, ...extra, genotypes: geno(genes) });

const CPIC = (s) => `CPIC ${s}`;
export const CASES = [
  // --- abacavir / HLA-B*57:01 (CPIC 2014 update; PMC3994233)
  { id: 'abc-pos', source: CPIC('abacavir/HLA-B 2014'), drug: 'abacavir', patient: P({}, { 'HLA-B*57:01': 'positive' }), expected: 'avoid' },
  { id: 'abc-neg', source: CPIC('abacavir/HLA-B 2014'), drug: 'abacavir', patient: P({}, { 'HLA-B*57:01': 'negative' }), expected: 'no_flag' },
  // --- allopurinol / HLA-B*58:01 (CPIC 2015 update; PMC4675696)
  { id: 'allo-pos', source: CPIC('allopurinol/HLA-B 2015'), drug: 'allopurinol', patient: P({}, { 'HLA-B*58:01': 'positive' }), expected: 'avoid' },
  { id: 'allo-neg', source: CPIC('allopurinol/HLA-B 2015'), drug: 'allopurinol', patient: P({}, { 'HLA-B*58:01': 'negative' }), expected: 'no_flag' },
  // --- carbamazepine / oxcarbazepine HLA-B*15:02 (CPIC 2017; PMC5847474) — naive patients
  { id: 'cbz-pos-naive', source: CPIC('CBZ/OXC 2017'), drug: 'carbamazepine', patient: P({ priorExposure: { carbamazepine: 'naive' } }, { 'HLA-B*15:02': 'positive' }), expected: 'avoid' },
  { id: 'cbz-pos-prior', source: CPIC('CBZ/OXC 2017 (recommendation addresses naive patients)'), drug: 'carbamazepine', patient: P({ priorExposure: { carbamazepine: 'prior' } }, { 'HLA-B*15:02': 'positive' }), expected: 'conditional' },
  { id: 'cbz-pos-unk', source: CPIC('CBZ/OXC 2017'), drug: 'carbamazepine', patient: P({}, { 'HLA-B*15:02': 'positive' }), expected: 'conditional' },
  { id: 'cbz-neg', source: CPIC('CBZ/OXC 2017'), drug: 'carbamazepine', patient: P({}, { 'HLA-B*15:02': 'negative', 'HLA-A*31:01': 'negative' }), expected: 'no_flag' },
  { id: 'cbz-b1502-neg-a3101-untested', source: 'engine policy: missing data never normal', drug: 'carbamazepine', patient: P({}, { 'HLA-B*15:02': 'negative' }), expected: 'needs_info' },
  { id: 'cbz-a3101-pos-naive', source: CPIC('CBZ/OXC 2017 + DPWG HLA-A*31:01'), drug: 'carbamazepine', patient: P({ priorExposure: { carbamazepine: 'naive' } }, { 'HLA-B*15:02': 'negative', 'HLA-A*31:01': 'positive' }), expected: 'modify' },
  { id: 'oxc-pos-naive', source: CPIC('CBZ/OXC 2017 (oxcarbazepine: avoid if naive)'), drug: 'oxcarbazepine', patient: P({ priorExposure: { oxcarbazepine: 'naive' } }, { 'HLA-B*15:02': 'positive' }), expected: 'avoid' },
  // --- codeine / CYP2D6 (CPIC 2021; PMC8249478) and FDA 2017
  { id: 'cod-um', source: CPIC('opioids 2021'), drug: 'codeine', patient: P({}, { CYP2D6: 'ultrarapid' }), expected: 'avoid' },
  { id: 'cod-pm', source: CPIC('opioids 2021'), drug: 'codeine', patient: P({}, { CYP2D6: 'poor' }), expected: 'avoid' },
  { id: 'cod-nm-adult', source: CPIC('opioids 2021 (no PGx action for normal)'), drug: 'codeine', patient: P({}, { CYP2D6: 'normal' }), expected: 'no_flag' },
  { id: 'cod-age-11', source: 'FDA DSC 2017-04-20: contraindicated <12', drug: 'codeine', patient: P({ age: 11 }, { CYP2D6: 'normal' }), expected: 'avoid' },
  { id: 'cod-age-12', source: 'FDA DSC 2017-04-20: warning 12-18 w/ risk factors', drug: 'codeine', patient: P({ age: 12 }, { CYP2D6: 'normal' }), expected: 'conditional' },
  { id: 'cod-age-17', source: 'FDA DSC 2017-04-20', drug: 'codeine', patient: P({ age: 17 }, { CYP2D6: 'normal' }), expected: 'conditional' },
  { id: 'cod-age-18', source: 'FDA DSC 2017-04-20 (rule ends at 18)', drug: 'codeine', patient: P({ age: 18 }, { CYP2D6: 'normal' }), expected: 'no_flag' },
  { id: 'cod-bf', source: 'FDA DSC 2017-04-20: recommends against in breastfeeding', drug: 'codeine', patient: P({ breastfeeding: 'yes' }, { CYP2D6: 'normal' }), expected: 'avoid' },
  // --- clopidogrel / CYP2C19 (CPIC 2022; PMC9287492)
  { id: 'clo-im-acs', source: CPIC('clopidogrel 2022 (ACS/PCI)'), drug: 'clopidogrel', patient: P({ indication: 'acs_pci' }, { CYP2C19: 'intermediate' }), expected: 'modify' },
  { id: 'clo-pm-acs', source: CPIC('clopidogrel 2022 (ACS/PCI)'), drug: 'clopidogrel', patient: P({ indication: 'acs_pci' }, { CYP2C19: 'poor' }), expected: 'modify' },
  { id: 'clo-pm-unk', source: CPIC('clopidogrel 2022 (indication-dependent)'), drug: 'clopidogrel', patient: P({}, { CYP2C19: 'poor' }), expected: 'conditional' },
  { id: 'clo-pm-other', source: CPIC('clopidogrel 2022 (indication-dependent)'), drug: 'clopidogrel', patient: P({ indication: 'other_antiplatelet' }, { CYP2C19: 'poor' }), expected: 'conditional' },
  { id: 'clo-pm-othercv', source: CPIC('clopidogrel 2022: cardiovascular indications (ClinPGx PA166104948)'), drug: 'clopidogrel', patient: P({ indication: 'other_cardiovascular' }, { CYP2C19: 'poor' }), expected: 'modify' },
  { id: 'clo-im-neuro', source: CPIC('clopidogrel 2022: neurovascular indications (ClinPGx PA166104948)'), drug: 'clopidogrel', patient: P({ indication: 'neurovascular' }, { CYP2C19: 'intermediate' }), expected: 'modify' },
  { id: 'clo-nm', source: CPIC('clopidogrel 2022'), drug: 'clopidogrel', patient: P({ indication: 'acs_pci' }, { CYP2C19: 'normal' }), expected: 'no_flag' },
  // --- thiopurines TPMT/NUDT15 (CPIC 2018; PMC6576267)
  { id: 'aza-tpmt-pm', source: CPIC('thiopurines 2018'), drug: 'azathioprine', patient: P({}, { TPMT: 'poor', NUDT15: 'normal' }), expected: 'modify' },
  { id: 'aza-tpmt-im', source: CPIC('thiopurines 2018'), drug: 'azathioprine', patient: P({}, { TPMT: 'intermediate', NUDT15: 'normal' }), expected: 'modify' },
  { id: 'aza-nudt-pm', source: CPIC('thiopurines 2018'), drug: 'azathioprine', patient: P({}, { TPMT: 'normal', NUDT15: 'poor' }), expected: 'modify' },
  { id: 'aza-nudt-im', source: CPIC('thiopurines 2018'), drug: 'azathioprine', patient: P({}, { TPMT: 'normal', NUDT15: 'intermediate' }), expected: 'modify' },
  { id: 'aza-compound-im', source: 'CPIC thiopurines (ClinPGx PA166104933): compound TPMT/NUDT15 IM need further reduction', drug: 'azathioprine', patient: P({}, { TPMT: 'intermediate', NUDT15: 'intermediate' }), expected: 'modify' },
  { id: 'aza-both-normal', source: CPIC('thiopurines 2018'), drug: 'azathioprine', patient: P({}, { TPMT: 'normal', NUDT15: 'normal' }), expected: 'no_flag' },
  { id: 'aza-nudt-untested', source: 'engine policy: missing data never normal', drug: 'azathioprine', patient: P({}, { TPMT: 'normal' }), expected: 'needs_info' },
  // --- DPYD fluoropyrimidines (NCBI MGS summary of CPIC)
  { id: '5fu-pm', source: 'NCBI MGS NBK395610 (CPIC summary)', drug: 'fluorouracil', patient: P({}, { DPYD: 'poor' }), expected: 'avoid' },
  { id: '5fu-im', source: 'NCBI MGS NBK395610 (CPIC summary)', drug: 'fluorouracil', patient: P({}, { DPYD: 'intermediate' }), expected: 'modify' },
  { id: 'cap-pm', source: 'NCBI MGS NBK395610 (CPIC summary)', drug: 'capecitabine', patient: P({}, { DPYD: 'poor' }), expected: 'avoid' },
  { id: 'cap-nm', source: 'NCBI MGS NBK395610 (CPIC summary)', drug: 'capecitabine', patient: P({}, { DPYD: 'normal' }), expected: 'no_flag' },
  // --- statins SLCO1B1 (CPIC 2022)
  { id: 'sim-dec', source: CPIC('statins 2022'), drug: 'simvastatin', patient: P({}, { SLCO1B1: 'decreased' }), expected: 'modify' },
  { id: 'sim-poor', source: CPIC('statins 2022'), drug: 'simvastatin', patient: P({}, { SLCO1B1: 'poor' }), expected: 'modify' },
  { id: 'sim-norm', source: CPIC('statins 2022'), drug: 'simvastatin', patient: P({}, { SLCO1B1: 'normal' }), expected: 'no_flag' },
  { id: 'ato-dec', source: 'ClinPGx annotation of CPIC 2022 (atorvastatin <=40 mg start)', drug: 'atorvastatin', patient: P({}, { SLCO1B1: 'decreased' }), expected: 'modify' },
  { id: 'ato-poor', source: 'ClinPGx annotation of CPIC 2022 (atorvastatin <=20 mg start)', drug: 'atorvastatin', patient: P({}, { SLCO1B1: 'poor' }), expected: 'modify' },
  // --- metformin / eGFR (FDA DSC 2016-04-08)
  { id: 'met-egfr-29', source: 'FDA DSC 2016-04-08: contraindicated eGFR<30', drug: 'metformin', patient: P({ egfrValue: '29' }), expected: 'avoid' },
  { id: 'met-egfr-29.9', source: 'FDA DSC 2016-04-08', drug: 'metformin', patient: P({ egfrValue: '29.9' }), expected: 'avoid' },
  { id: 'met-egfr-30-new', source: 'FDA DSC 2016-04-08: starting not recommended 30-45', drug: 'metformin', patient: P({ egfrValue: '30', priorExposure: { metformin: 'naive' } }), expected: 'avoid' },
  { id: 'met-egfr-44-new', source: 'FDA DSC 2016-04-08', drug: 'metformin', patient: P({ egfrValue: '44', priorExposure: { metformin: 'naive' } }), expected: 'avoid' },
  { id: 'met-egfr-44-ongoing', source: 'FDA DSC 2016-04-08: assess benefit/risk if on therapy', drug: 'metformin', patient: P({ egfrValue: '44', currentMedications: ['metformin 500 mg'] }), expected: 'conditional' },
  { id: 'met-egfr-45', source: 'FDA DSC 2016-04-08 (no restriction at >=45)', drug: 'metformin', patient: P({ egfrValue: '45' }), expected: 'no_flag' },
  { id: 'met-egfr-missing', source: 'engine policy: generic "impaired" flag is not an eGFR', drug: 'metformin', patient: P({ egfrValue: '' }), expected: 'needs_info' },
  // --- CYP2D6 TCAs
  { id: 'ami-2d6-um', source: 'CPIC TCA 2016 (ClinPGx PA166105006) + DPWG (PA166104982)', drug: 'amitriptyline', patient: P({}, { 'CYP2D6': 'ultrarapid' }), expected: 'modify' },
  { id: 'ami-2d6-pm', source: 'CPIC TCA 2016 (ClinPGx PA166105006) + DPWG (PA166104982)', drug: 'amitriptyline', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'ami-2d6-im', source: 'DPWG amitriptyline/CYP2D6 (ClinPGx PA166104982)', drug: 'amitriptyline', patient: P({}, { 'CYP2D6': 'intermediate' }), expected: 'modify' },
  { id: 'ami-2d6-nm', source: 'CPIC TCA 2016 (no action for CYP2D6 normal)', drug: 'amitriptyline', patient: P({}, { 'CYP2D6': 'normal', 'CYP2C19': 'normal' }), expected: 'no_flag' },
  { id: 'ami-2c19-um', source: 'CPIC TCA 2016 (ClinPGx PA166105006)', drug: 'amitriptyline', patient: P({}, { 'CYP2C19': 'ultrarapid', 'CYP2D6': 'normal' }), expected: 'modify' },
  { id: 'ami-2c19-pm', source: 'CPIC TCA 2016 (ClinPGx PA166105006)', drug: 'amitriptyline', patient: P({}, { 'CYP2C19': 'poor', 'CYP2D6': 'normal' }), expected: 'modify' },
  { id: 'nort-2d6-um', source: 'CPIC nortriptyline (ClinPGx PA166104998)', drug: 'nortriptyline', patient: P({}, { 'CYP2D6': 'ultrarapid' }), expected: 'modify' },
  { id: 'nort-2d6-pm', source: 'CPIC nortriptyline (ClinPGx PA166104998)', drug: 'nortriptyline', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'nort-2d6-im', source: 'CPIC nortriptyline (ClinPGx PA166104998)', drug: 'nortriptyline', patient: P({}, { 'CYP2D6': 'intermediate' }), expected: 'modify' },
  { id: 'clomi-2d6-pm', source: 'CPIC TCA 2016 (ClinPGx PA166105007) + DPWG (PA166104964)', drug: 'clomipramine', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'clomi-2c19-um', source: 'DPWG clomipramine/CYP2C19 (ClinPGx PA166184528)', drug: 'clomipramine', patient: P({}, { 'CYP2C19': 'ultrarapid', 'CYP2D6': 'normal' }), expected: 'modify' },
  { id: 'desip-2d6-pm', source: 'CPIC desipramine (ClinPGx PA166105002)', drug: 'desipramine', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'desip-2d6-im', source: 'CPIC desipramine (ClinPGx PA166105002)', drug: 'desipramine', patient: P({}, { 'CYP2D6': 'intermediate' }), expected: 'modify' },
  { id: 'imi-2d6-pm', source: 'DPWG imipramine/CYP2D6 (ClinPGx PA166104972)', drug: 'imipramine', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'imi-2d6-im', source: 'DPWG imipramine/CYP2D6 (ClinPGx PA166104972)', drug: 'imipramine', patient: P({}, { 'CYP2D6': 'intermediate' }), expected: 'modify' },
  { id: 'imi-2c19-pm', source: 'DPWG imipramine/CYP2C19 (ClinPGx PA166104954)', drug: 'imipramine', patient: P({}, { 'CYP2C19': 'poor', 'CYP2D6': 'normal' }), expected: 'modify' },
  // --- CYP2C19 SSRIs
  { id: 'cit-2c19-um', source: 'CPIC SSRI 2023 (ClinPGx PA166127638) + DPWG (PA166104977)', drug: 'citalopram', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  { id: 'cit-2c19-pm', source: 'DPWG citalopram/CYP2C19 (ClinPGx PA166104977)', drug: 'citalopram', patient: P({}, { 'CYP2C19': 'poor' }), expected: 'modify' },
  { id: 'esc-2c19-um', source: 'CPIC SSRI 2023 (ClinPGx PA166127638) + DPWG (PA166104975)', drug: 'escitalopram', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  { id: 'esc-2c19-im', source: 'DPWG escitalopram/CYP2C19 (ClinPGx PA166104975)', drug: 'escitalopram', patient: P({}, { 'CYP2C19': 'intermediate' }), expected: 'modify' },
  { id: 'esc-2c19-pm', source: 'DPWG escitalopram/CYP2C19 (ClinPGx PA166104975)', drug: 'escitalopram', patient: P({}, { 'CYP2C19': 'poor' }), expected: 'modify' },
  { id: 'sert-2c19-um', source: 'CPIC sertraline (ClinPGx PA166127639)', drug: 'sertraline', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  { id: 'sert-2c19-pm', source: 'DPWG sertraline/CYP2C19 (ClinPGx PA166104980) + CPIC (PA166127639)', drug: 'sertraline', patient: P({}, { 'CYP2C19': 'poor' }), expected: 'modify' },
  // --- Tacrolimus / CYP3A5
  { id: 'tacro-3a5-nm', source: 'CPIC tacrolimus (ClinPGx PA166124619) + DPWG (PA166104983)', drug: 'tacrolimus', patient: P({}, { 'CYP3A5': 'normal' }), expected: 'modify' },
  { id: 'tacro-3a5-im', source: 'CPIC tacrolimus (ClinPGx PA166124619) + DPWG (PA166104983)', drug: 'tacrolimus', patient: P({}, { 'CYP3A5': 'intermediate' }), expected: 'modify' },
  { id: 'tacro-3a5-pm', source: 'CPIC tacrolimus (ClinPGx PA166124619): non-expressors use standard dose', drug: 'tacrolimus', patient: P({}, { 'CYP3A5': 'poor' }), expected: 'no_flag' },
  // --- Warfarin
  { id: 'warf-2c9-pm', source: 'DPWG warfarin/CYP2C9 (ClinPGx PA166182842) + CPIC (PA166104949)', drug: 'warfarin', patient: P({}, { 'CYP2C9': 'poor' }), expected: 'modify' },
  { id: 'warf-2c9-im', source: 'DPWG warfarin/CYP2C9 (ClinPGx PA166182842)', drug: 'warfarin', patient: P({}, { 'CYP2C9': 'intermediate' }), expected: 'modify' },
  { id: 'warf-vkorc1-v', source: 'DPWG warfarin/VKORC1 (ClinPGx PA166182841) + CPIC (PA166104949)', drug: 'warfarin', patient: P({}, { 'VKORC1': 'variant_present' }), expected: 'modify' },
  { id: 'warf-cyp4f2-v', source: 'CPIC warfarin (ClinPGx PA166104949): CYP4F2 variant affects dosing algorithm', drug: 'warfarin', patient: P({}, { 'CYP4F2': 'variant_present' }), expected: 'modify' },
  // --- Tamoxifen
  { id: 'tam-2d6-pm', source: 'CPIC tamoxifen (ClinPGx PA166176068) + DPWG (PA166104966)', drug: 'tamoxifen', patient: P({}, { 'CYP2D6': 'poor' }), expected: 'modify' },
  { id: 'tam-2d6-im', source: 'DPWG tamoxifen/CYP2D6 (ClinPGx PA166104966)', drug: 'tamoxifen', patient: P({}, { 'CYP2D6': 'intermediate' }), expected: 'modify' },
  // --- PPIs
  { id: 'ome-2c19-um', source: 'CPIC PPI 2021 (ClinPGx PA166219103) + DPWG (PA166104957)', drug: 'omeprazole', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  { id: 'lans-2c19-um', source: 'CPIC PPI 2021 (ClinPGx PA166219103) + DPWG (PA166104987)', drug: 'lansoprazole', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  // --- Voriconazole
  { id: 'vori-2c19-um', source: 'CPIC voriconazole (ClinPGx PA166161537) + DPWG (PA166104990) + AusNZ (PA166257241)', drug: 'voriconazole', patient: P({}, { 'CYP2C19': 'ultrarapid' }), expected: 'modify' },
  { id: 'vori-2c19-pm', source: 'CPIC voriconazole (ClinPGx PA166161537): alternative antifungal for adult PM; DPWG (PA166104990): 50% dose as secondary path', drug: 'voriconazole', patient: P({}, { 'CYP2C19': 'poor' }), expected: 'modify' },
  // --- Irinotecan
  { id: 'iri-ugt1a1-pm', source: 'DPWG irinotecan/UGT1A1 (ClinPGx PA166104951)', drug: 'irinotecan', patient: P({}, { 'UGT1A1': 'poor' }), expected: 'modify' },
  // --- G6PD drugs (CPIC G6PD 2023; PMC10281211)
  { id: 'dap-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'dapsone', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'dap-g6pd-nm', source: 'CPIC G6PD 2023 (ClinPGx PA166119846): normal G6PD — no flag', drug: 'dapsone', patient: P({}, { 'G6PD': 'normal' }), expected: 'no_flag' },
  { id: 'mb-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'methylene-blue', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'peglo-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'pegloticase', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'rasb-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'rasburicase', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'taf-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'tafenoquine', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'tolb-g6pd-def', source: 'CPIC G6PD 2023 (ClinPGx PA166119846)', drug: 'toluidine-blue', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'prim-g6pd-def', source: 'CPIC primaquine/G6PD (ClinPGx PA166279621) + PA166119846', drug: 'primaquine', patient: P({}, { 'G6PD': 'deficient' }), expected: 'avoid' },
  { id: 'prim-g6pd-var', source: 'CPIC primaquine/G6PD (ClinPGx PA166279621): variable requires specialist review', drug: 'primaquine', patient: P({}, { 'G6PD': 'variable' }), expected: 'conditional' },
  { id: 'prim-g6pd-nm', source: 'CPIC primaquine/G6PD (ClinPGx PA166279621): normal G6PD — no flag', drug: 'primaquine', patient: P({}, { 'G6PD': 'normal' }), expected: 'no_flag' },
];
