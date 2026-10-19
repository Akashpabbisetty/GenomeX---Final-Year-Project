import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { evaluatePatientAsync, loadDatasetFromFs } from '../engine/index.js';
import { buildApiResponse } from './evaluate.js';
import { checkAuth } from './auth.js';
import { logAudit } from './audit.js';

/**
 * Reads the full POST body from an IncomingMessage.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<string>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Sends a JSON response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    // CORS header for local dev only — restrict in production
    'Access-Control-Allow-Origin': '*',
  });
  res.end(payload);
}

/**
 * Returns an async request handler that uses the provided dataset.
 * Exported so that tests can inject their own server instance.
 *
 * @param {import('../engine/index.js').Dataset} ds
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function makeHandler(ds) {
  return async function handler(req, res) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, x-api-key' });
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/api/evaluate') {
      // (b) Auth check
      const auth = checkAuth(req);
      if (!auth.ok) {
        sendJson(res, 401, { error: auth.reason });
        return;
      }

      // (a) Read and parse body
      let raw;
      try {
        const bodyText = await readBody(req);
        raw = JSON.parse(bodyText);
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON in request body' });
        return;
      }

      // (d) Run engine evaluation
      const analysis = await evaluatePatientAsync(raw, ds);

      // Return 422 if validation produced hard errors
      if (analysis.validation.errors.length > 0) {
        sendJson(res, 422, { error: 'Validation failed', details: analysis.validation.errors });
        return;
      }

      // (e) Build API response
      const response = buildApiResponse(analysis);

      // (f) Audit log (ID + metadata only — no clinical data)
      logAudit({
        patientId: raw.pseudonym || null,
        ruleSetVersion: analysis.meta.ruleSetVersion,
        timestamp: analysis.meta.generatedAt,
      });

      // (g) Return 200
      sendJson(res, 200, response);
      return;
    }

    // 404 for all other routes
    sendJson(res, 404, { error: 'Not found' });
  };
}

// ── Start server when run directly ──────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = Number(process.env.PORT) || 3001;
  const ROOT = fileURLToPath(new URL('..', import.meta.url));

  if (!process.env.GENOMX_API_KEY) {
    console.warn('[server] WARNING: GENOMX_API_KEY is not set. Running in dev mode — all requests are accepted without authentication.');
    console.warn('[server] IMPORTANT: Real patient data MUST NOT be used until a full security and ethics review is complete.');
  }

  const ds = await loadDatasetFromFs(ROOT);
  console.log(`[server] Dataset loaded. ruleSetVersion: ${ds.meta.ruleSetVersion}`);

  const server = createServer(makeHandler(ds));
  server.listen(PORT, () => {
    console.log(`[server] GenomX API listening on http://localhost:${PORT}`);
  });
}
