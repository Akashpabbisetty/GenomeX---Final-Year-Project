import fs from 'node:fs'; import vm from 'node:vm';
const src = fs.readFileSync('research/legacy_app.js','utf8');
const grab = (name) => { const i = src.indexOf(`const ${name} = `); const j = src.indexOf('\n};', i) + 3; return src.slice(i, j); };
const ctx = {}; vm.createContext(ctx);
vm.runInContext(grab('DRUG_INTERACTIONS') + ';' + grab('DIAGNOSIS_RULES') + ';this.I=DRUG_INTERACTIONS;this.D=DIAGNOSIS_RULES;', ctx);
const count = o => Object.values(o).reduce((a, v) => a + v.length, 0);
fs.writeFileSync('data/unverified/legacy_interactions.json', JSON.stringify({ WARNING: 'UNVERIFIED. Hand-written in the prototype with no sources. NOT used by the engine.', interactions: ctx.I }, null, 1));
fs.writeFileSync('data/unverified/legacy_diagnosis_rules.json', JSON.stringify({ WARNING: 'UNVERIFIED. Hand-written in the prototype with no sources, matched on free text. NOT used by the engine.', rules: ctx.D }, null, 1));
console.log('interaction pairs:', count(ctx.I), ' diagnosis rules:', count(ctx.D));
