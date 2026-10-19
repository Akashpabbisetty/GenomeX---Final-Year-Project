// SYNTHETIC / RESEARCH USE ONLY. All output is clearly labelled.
// Real patient data MUST NOT be used until a full security and ethics review is complete.

import { createReadStream, createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { evaluatePatient, loadDatasetFromFs } from '../../engine/index.js';

// Project root: two levels up from genomex-final/api/
const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const USAGE = `Usage: node genomex-final/api/batch_evaluate.js <input.ndjson> <output.ndjson>

Reads patient JSON records (one per line) from <input.ndjson>, evaluates each
record against the rule engine, and writes one NDJSON result line per patient
to <output.ndjson>.

Output fields per line:
  synthetic         always true — this tool is for synthetic/research use only
  batchProcessedAt  ISO timestamp of when the record was evaluated
  ruleSetVersion    engine rule-set version
  patientIndex      0-based line number from the input file
  validation        { errors, warnings } from patient normalisation
  meta              { evaluatedDrugs, ruleSetVersion, generatedAt }
  summaryByCategory counts of drugs per action category (no score values)

No full findings array is written — only the summary per category.

Options:
  --help    Show this message and exit.
`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.length === 0) {
  process.stdout.write(USAGE);
  process.exit(args.includes('--help') ? 0 : 1);
}

if (args.length < 2) {
  process.stderr.write(`Error: expected <input> <output>, got ${args.length} argument(s).\n\n${USAGE}`);
  process.exit(1);
}

const [inputPath, outputPath] = args;

// Load dataset synchronously (awaited at top-level in ESM)
const ds = await loadDatasetFromFs(ROOT);

const outStream = createWriteStream(outputPath, { encoding: 'utf8' });
const rl = createInterface({ input: createReadStream(inputPath, { encoding: 'utf8' }), crlfDelay: Infinity });

let patientIndex = 0;
const t0 = performance.now();

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue; // skip blank lines

  const batchProcessedAt = new Date().toISOString();
  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch (parseErr) {
    // Write an error record rather than aborting the whole batch
    const errRecord = {
      synthetic: true,
      batchProcessedAt,
      ruleSetVersion: ds.meta.ruleSetVersion,
      patientIndex,
      error: `JSON parse error on line ${patientIndex + 1}: ${parseErr.message}`,
    };
    outStream.write(JSON.stringify(errRecord) + '\n');
    patientIndex++;
    continue;
  }

  // Synchronous evaluation (no SIDER lazy-loading in batch mode)
  const analysis = evaluatePatient(raw, ds);

  const record = {
    synthetic: true,
    batchProcessedAt,
    ruleSetVersion: ds.meta.ruleSetVersion,
    patientIndex,
    validation: analysis.validation,
    meta: {
      evaluatedDrugs: analysis.meta.evaluatedDrugs,
      ruleSetVersion: analysis.meta.ruleSetVersion,
      generatedAt: analysis.meta.generatedAt,
    },
    summaryByCategory: analysis.summaryByCategory,
  };

  outStream.write(JSON.stringify(record) + '\n');
  patientIndex++;
}

outStream.end();

const ms = performance.now() - t0;
const perSec = patientIndex > 0 ? (patientIndex / (ms / 1000)).toFixed(1) : '0';
console.log(`Processed ${patientIndex} patient${patientIndex !== 1 ? 's' : ''} in ${ms.toFixed(0)} ms = ${perSec} patients/second`);
