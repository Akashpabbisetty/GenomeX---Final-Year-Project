// One-off migration: splits the legacy app.js catalog into (a) a clean identification-only
// drug catalog and (b) quarantined, UNVERIFIED legacy claims that no rule may use.
import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync('research/legacy_app.js','utf8');
const grab = (name) => { const i = src.indexOf(`const ${name} = `); const j = src.indexOf('\n];', i) + 3; return src.slice(i, j); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(grab('DRUGS') + ';' + grab('GENES') + ';' + grab('ALLERGIES') + ';this.DRUGS=DRUGS;this.GENES=GENES;this.ALLERGIES=ALLERGIES;', ctx);
const DRUGS = ctx.DRUGS;
const slug = n => n.toLowerCase().replace(/\s*\(.*\)/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
const aliases = {
  warfarin:['coumadin','jantoven'], clopidogrel:['plavix'], omeprazole:['prilosec'], ibuprofen:['advil','motrin'],
  aspirin:['acetylsalicylic acid','asa'], 'trimethoprim-sulfamethoxazole':['co-trimoxazole','cotrimoxazole','bactrim','septra','trimethoprim/sulfamethoxazole'],
  'fluorouracil':['5-fu','5fu','fluorouracil (5-fu)'], amoxicillin:['amoxil'], metformin:['glucophage'], levothyroxine:['synthroid'],
  simvastatin:['zocor'], atorvastatin:['lipitor'], rosuvastatin:['crestor'], codeine:[], citalopram:['celexa'], escitalopram:['lexapro'],
  carbamazepine:['tegretol'], oxcarbazepine:['trileptal'], phenytoin:['dilantin'], allopurinol:['zyloprim'], abacavir:['ziagen'],
  capecitabine:['xeloda'], irinotecan:['camptosar'], tamoxifen:['nolvadex'], voriconazole:['vfend'], amitriptyline:['elavil'],
  atomoxetine:['strattera'], ondansetron:['zofran'], azathioprine:['imuran'], cephalexin:['cefalexin','keflex'],
};
const drugs = DRUGS.map(d => ({ id: slug(d.name), name: d.name, class: d.class, aliases: aliases[slug(d.name)] || [] }));
const legacy = DRUGS.map(d => ({ id: slug(d.name), legacy_unverified: {
  gene: d.gene ?? null, geneSeverity: d.geneSeverity ?? null, allergy: d.allergy ?? null, allergySeverity: d.allergySeverity ?? null,
  uses: d.uses, mechanism: d.mechanism, sideEffects: d.sideEffects, contraindications: d.contraindications, cpic: d.cpic,
  evidence: d.evidence, confidence_ILLUSTRATIVE_DO_NOT_USE: d.confidence, alternatives: d.alternatives,
  pregnancyRisk: !!d.pregnancyRisk, pediatricRisk: !!d.pediatricRisk, renalCaution: !!d.renalCaution, hepaticCaution: !!d.hepaticCaution } }));
fs.writeFileSync('data/drugs.json', JSON.stringify({ schema: 'drugs/1', drugs }, null, 1));
fs.writeFileSync('data/unverified/legacy_drug_claims.json', JSON.stringify({
  WARNING: 'UNVERIFIED legacy claims from the original prototype. Not used by the engine. Confidence values are illustrative and meaningless. Each claim must be re-verified against a primary source before promotion into data/rules/.',
  drugs: legacy }, null, 1));
console.log('drugs:', drugs.length);
