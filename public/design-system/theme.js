import {resolveTokens} from './tokens.js';
// Call before paint, or stamp data-theme on the server. Existing stamps win.
// Applications supply persistence; no cookie-domain or next-themes assumptions.
export function installTheme({root = document.documentElement, preference, persist = () => {}, onChange = () => {}, media = matchMedia('(prefers-color-scheme: dark)')} = {}) {
  let mode = root.dataset.theme || preference || 'system';
  const validate = value => {if (!['system', 'light', 'dark'].includes(value)) throw new RangeError('Unknown appearance');};
  validate(mode);
  function apply() {
    const appearance = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    const tokens = resolveTokens({project: root.dataset.project || 'finance', appearance, density: root.dataset.density || 'comfortable'});
    root.dataset.theme = appearance;
    root.style.colorScheme = appearance;
    root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['surface-page']);
    onChange({appearance, tokens});
  }
  function followSystem() {if (mode === 'system') apply();}
  media.addEventListener('change', followSystem);
  apply();
  return {setAppearance(value) {validate(value); mode = value; persist(value); apply();}, refresh: apply, destroy() {media.removeEventListener('change', followSystem);}};
}
