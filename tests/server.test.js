import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { ds } from './helpers.js';
import { BASE } from './fixtures/reference_cases.js';
import { makeHandler } from '../server/index.js';
import { DISCLAIMER } from '../engine/report.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Starts a local HTTP server on an OS-assigned port.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const server = createServer(makeHandler(ds));
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res, rej) => server.close(err => err ? rej(err) : res())),
      });
    });
    server.on('error', reject);
  });
}

/**
 * Sends a POST /api/evaluate request with a JSON body.
 * @param {string} baseUrl  - e.g. 'http://127.0.0.1:PORT'
 * @param {unknown} body    - serialised as JSON
 * @returns {Promise<{ status: number, json: unknown }>}
 */
function postEvaluate(baseUrl, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const { hostname, port } = new URL(baseUrl);
    const req = httpRequest(
      {
        hostname,
        port: Number(port),
        path: '/api/evaluate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end(payload);
  });
}

/**
 * Sends a POST /api/evaluate with a raw (possibly non-JSON) body.
 */
function postRaw(baseUrl, rawBody) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const req = httpRequest(
      {
        hostname,
        port: Number(port),
        path: '/api/evaluate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(rawBody),
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end(rawBody);
  });
}

/**
 * Sends a GET request to an arbitrary path and returns status + parsed JSON.
 */
function getPath(baseUrl, path) {
  return new Promise((resolve, reject) => {
    const { hostname, port } = new URL(baseUrl);
    const req = httpRequest(
      { hostname, port: Number(port), path, method: 'GET' },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

/** Recursively collect all object keys from any JSON value */
function allKeys(value, found = new Set()) {
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const item of value) allKeys(item, found);
    } else {
      for (const [k, v] of Object.entries(value)) {
        found.add(k);
        allKeys(v, found);
      }
    }
  }
  return found;
}

const FORBIDDEN_SCORE_KEYS = ['score', 'confidence', 'riskscore', 'probability', 'overall_score'];

// ── Tests ────────────────────────────────────────────────────────────────────

test('POST /api/evaluate with a valid minimal patient returns 200 with required fields and no numeric score', async () => {
  const { url, close } = await startServer();
  try {
    const { status, json } = await postEvaluate(url, BASE);
    assert.equal(status, 200);

    // Required top-level fields
    assert.ok(typeof json.ruleSetVersion === 'string' && json.ruleSetVersion.length > 0,
      'ruleSetVersion must be a non-empty string');
    assert.ok(typeof json.disclaimer === 'string' && json.disclaimer.length > 0,
      'disclaimer must be a non-empty string');
    assert.ok(typeof json.dataAttributions === 'string' && json.dataAttributions.length > 0,
      'dataAttributions must be a non-empty string');
    assert.ok(Array.isArray(json.findings), 'findings must be an array');
    assert.ok(Array.isArray(json.missingInformation), 'missingInformation must be an array');
    assert.ok(Array.isArray(json.evidence), 'evidence must be an array');

    // No numeric score fields anywhere in the response
    const keys = allKeys(json);
    for (const forbidden of FORBIDDEN_SCORE_KEYS) {
      assert.ok(!keys.has(forbidden), `Response must not contain key "${forbidden}"`);
    }
  } finally {
    await close();
  }
});

test('validation errors return 422 with details', async () => {
  const { url, close } = await startServer();
  try {
    const { status, json } = await postEvaluate(url, { age: -1 });
    assert.equal(status, 422);
    assert.ok(Array.isArray(json.details), 'details must be an array');
    assert.ok(json.details.length > 0, 'details must have at least one entry');
  } finally {
    await close();
  }
});

test('empty JSON body returns 200 (engine normalizes empty input) with required fields', async () => {
  const { url, close } = await startServer();
  try {
    const { status, json } = await postEvaluate(url, {});
    assert.equal(status, 200);
    assert.ok(typeof json.ruleSetVersion === 'string', 'ruleSetVersion must be present');
    assert.ok(Array.isArray(json.findings), 'findings must be an array');
    assert.ok(Array.isArray(json.missingInformation), 'missingInformation must be an array');
    assert.ok(Array.isArray(json.evidence), 'evidence must be an array');
  } finally {
    await close();
  }
});

test('unknown route returns 404', async () => {
  const { url, close } = await startServer();
  try {
    const { status } = await getPath(url, '/not-a-real-route');
    assert.equal(status, 404);
  } finally {
    await close();
  }
});

test('bad JSON returns 400', async () => {
  const { url, close } = await startServer();
  try {
    const { status } = await postRaw(url, '{not valid json}');
    assert.equal(status, 400);
  } finally {
    await close();
  }
});

test('response disclaimer matches the engine DISCLAIMER constant', async () => {
  const { url, close } = await startServer();
  try {
    const { status, json } = await postEvaluate(url, BASE);
    assert.equal(status, 200);
    assert.equal(json.disclaimer, DISCLAIMER);
  } finally {
    await close();
  }
});
