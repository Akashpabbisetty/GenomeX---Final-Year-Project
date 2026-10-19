import { loadDatasetFromUrls } from '../../engine/index.js';
import { initApp } from './app.js';

(async () => {
  try {
    const ds = await loadDatasetFromUrls(new URL('../../', import.meta.url).href);
    if (ds.validation.errors.length) throw new Error('Rule data failed validation: ' + ds.validation.errors.slice(0, 3).join('; '));
    initApp(ds);
  } catch (e) {
    const box = document.getElementById('loadError'); box.hidden = false;
    box.textContent = 'The knowledge base could not be loaded, so no analysis is available. Serve the project root over http (e.g. "npm run serve") and open /frontend/genomx-advisor.html. Details: ' + e.message;
  }
})();
