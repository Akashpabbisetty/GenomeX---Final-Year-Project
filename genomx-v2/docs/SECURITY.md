# Security & privacy review (prototype)

| Area | Finding / action | Verified by |
|---|---|---|
| XSS / unsafe DOM | Legacy had 12 `innerHTML` sites. v2 builds DOM only via `createElement`/`textContent` (`ui/dom.js`); no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` | static-scan test + hostile-input test |
| CSP | `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`. No inline scripts, handlers or styles | test |
| External requests | Google Fonts removed; no `fetch` except same-origin loading of static JSON; `referrer: no-referrer` | static-scan test |
| External links | Only `https://` evidence URLs from validated records, `rel="noopener noreferrer"` | test |
| Secrets | None in client code (scan for key/secret/token terms) | test |
| Patient data storage | None stored. Only `genomx-theme` and `genomx-tour-seen` use localStorage. Nothing transmitted | code review |
| Data minimisation | Removed name, sex, weight, height. Optional pseudonym only (truncated to 40 chars); report contains pseudonym + age | test |
| CSV export | Formula-injection neutralised (`= + - @` prefixed), quotes escaped | test |
| Error messages | Generic load error; no patient data in messages | review |
| Backend | The legacy FastAPI server (`research/`) has **no authentication, CORS `*`, no audit log** and is **not connected** to v2. Do not deploy it with real data |

## Not done / required before any clinical use
Authentication & authorisation, server-side validation, audit logging, encryption in transit/at rest, retention policy, penetration testing, accessibility audit with assistive technology, clinical safety case, and regulatory assessment (software as a medical device) — each needs separate assessment; no compliance (HIPAA/GDPR/MDR/etc.) is claimed.
