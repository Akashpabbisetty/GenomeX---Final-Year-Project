// TODO: Replace with a real authentication mechanism. SECURITY REVIEW REQUIRED before any real patient data is used. See docs/security.md.
// IMPORTANT: Real patient data MUST NOT be used until a full security and ethics review is complete.

/**
 * Checks the x-api-key request header against process.env.GENOMX_API_KEY.
 *
 * Dev mode: if GENOMX_API_KEY is not set in the environment, all requests are
 * allowed through and a startup warning is logged elsewhere. This makes local
 * development frictionless while keeping the hook for a real key in production.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkAuth(req) {
  const expectedKey = process.env.GENOMX_API_KEY;

  // Dev mode — no key configured, allow all requests
  if (!expectedKey) {
    return { ok: true };
  }

  const provided = req.headers['x-api-key'];
  if (provided && provided === expectedKey) {
    return { ok: true };
  }

  return { ok: false, reason: 'Invalid or missing API key' };
}
