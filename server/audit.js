// PHI NOTICE: Only pseudonym/ID and metadata are written here. Clinical findings,
// genotype data and all patient inputs are NEVER logged. Verify this independently
// before any use with identifiable data.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGS_DIR = join(PROJECT_ROOT, 'logs');
const AUDIT_FILE = join(LOGS_DIR, 'audit.ndjson');

/**
 * Appends a single NDJSON audit line to logs/audit.ndjson.
 * Only pseudonym/ID and rule-set metadata are written — NO clinical findings,
 * NO genotypes, NO other patient inputs.
 *
 * @param {{ patientId?: string, ruleSetVersion: string, timestamp: string }} entry
 */
export function logAudit({ patientId, ruleSetVersion, timestamp }) {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    const line = JSON.stringify({ ts: timestamp, patientId: patientId || null, ruleSetVersion }) + '\n';
    appendFileSync(AUDIT_FILE, line, 'utf8');
  } catch (err) {
    // A filesystem error must never crash the server — log to stderr only
    console.error('[audit] Failed to write audit log:', err.message);
  }
}
