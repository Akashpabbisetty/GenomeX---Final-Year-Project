import { h } from './dom.js';

/**
 * Renders the research-output panel into the given container element.
 * The panel is informational only — model predictions shown here are NEVER
 * used to alter any action category produced by the rule engine.
 *
 * @param {HTMLElement} container
 * @returns {Promise<HTMLElement>} the panel element that was appended
 */
export async function renderResearchPanel(container) {
  const panel = h('section', { class: 'research-panel' },
    h('h3', { text: 'Model-based drug-ADR association (research output — not yet available)' }),
  );

  // Attempt a HEAD request for the parquet file (same-origin, CSP connect-src 'self' permits this).
  let statusNode;
  try {
    const res = await fetch('../../data/model/assoc_scores.parquet', { method: 'HEAD' });
    if (res.ok) {
      statusNode = h('div', {},
        h('p', { text: 'Training results file found: data/model/assoc_scores.parquet' }),
        h('p', { text: 'Use Python + DuckDB to query: import duckdb; duckdb.query("SELECT * FROM \'data/model/assoc_scores.parquet\' LIMIT 10").fetchdf()' }),
      );
    } else {
      statusNode = h('p', { text: 'Training results not yet available. Run research/kg/run_all.py on an ML-capable machine.' });
    }
  } catch {
    statusNode = h('p', { text: 'Training results not yet available. Run research/kg/run_all.py on an ML-capable machine.' });
  }

  panel.append(
    statusNode,
    h('p', { text: 'Model predictions are research output only — shown separately from rule-based findings and NEVER used to alter any action category.' }),
    h('p', { class: 'disclaimer', text: 'RESEARCH OUTPUT — not clinically validated. Do not use for prescribing decisions.' }),
  );

  container.append(panel);
  return panel;
}
