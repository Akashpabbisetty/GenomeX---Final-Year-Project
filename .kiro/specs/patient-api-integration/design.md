# Design
- Thin Node (Fastify/Express) wrapper importing `engine/` directly (one code path); JSON-schema validation; rate limit; API key; structured audit log without PHI.
- Batch: `scripts/batch_evaluate.mjs` streaming CSV→JSONL; benchmark 100k patients.
- Research panel: lazy-load model scores per drug; show model version/hash + caveats.
- Browser verification: Playwright tests (real Chromium) incl. mobile/tablet viewports and an axe accessibility scan — jsdom could not verify layout.
