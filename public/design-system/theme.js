import {resolveTokens} from './tokens.js';
const valid = value => ['system', 'light', 'dark'].includes(value);
const validate = value => {if (!valid(value)) throw new RangeError('Unknown appearance');};
// A theme change recolors nearly every element at once; with their transitions
// running it smears instead of snapping. Off until the new colors have painted.
function withoutTransitions(doc, change) {
  const win = doc.defaultView;
  if (!doc.head || !win?.requestAnimationFrame) return change();
  const style = doc.createElement('style');
  style.textContent = '*,*::before,*::after{transition:none!important}';
  doc.head.append(style);
  const result = change();
  void doc.body?.offsetHeight;
  win.requestAnimationFrame(() => win.requestAnimationFrame(() => style.remove()));
  return result;
}
function applyTheme(root, preference, media) {
  return withoutTransitions(root.ownerDocument, () => paintTheme(root, preference, media));
}
function paintTheme(root, preference, media) {
  const appearance = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  const tokens = resolveTokens({project: root.dataset.project || 'finance', appearance, density: root.dataset.density || 'comfortable'});
  root.dataset.appearancePreference = preference;
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
  root.ownerDocument.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens['surface-page']);
  return {preference, appearance, tokens};
}
// Legacy injectable adapter. A consumer's existing resolved stamp still wins.
export function installTheme({root = document.documentElement, preference, persist = () => {}, onChange = () => {}, media = matchMedia('(prefers-color-scheme: dark)')} = {}) {
  let mode = root.dataset.theme || preference || 'system';
  validate(mode);
  const apply = () => onChange(applyTheme(root, mode, media));
  const followSystem = () => {if (mode === 'system') apply();};
  media.addEventListener('change', followSystem);
  apply();
  return {setAppearance(value) {validate(value); mode = value; persist(value); apply();}, refresh: apply, destroy() {media.removeEventListener('change', followSystem);}};
}
// Shared public/private appearance storage. Saved preference and resolved paint
// are deliberately separate: a prepaint dark stamp can still mean System mode.
export function createAppearanceController({root = document.documentElement, storageKey = 'sheet-theme', cookie = true, onChange = () => {}} = {}) {
  const doc = root.ownerDocument;
  const win = doc.defaultView || globalThis.window;
  const media = win.matchMedia('(prefers-color-scheme: dark)');
  const listeners = new Set();
  const cookiePreference = () => {
    if (!cookie) return undefined;
    try {
      const prefix = encodeURIComponent(storageKey) + '=';
      const item = doc.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
      const value = item && decodeURIComponent(item.slice(prefix.length));
      return valid(value) ? value : undefined;
    } catch {return undefined;}
  };
  const localPreference = () => {
    try {const value = win.localStorage.getItem(storageKey); return valid(value) ? value : undefined;} catch {return undefined;}
  };
  let mode = cookiePreference() || localPreference() || (valid(root.dataset.appearancePreference) ? root.dataset.appearancePreference : 'system');
  let state;
  let destroyed = false;
  function apply() {
    state = applyTheme(root, mode, media);
    onChange(state);
    listeners.forEach(listener => listener(state));
  }
  function persist(value) {
    try {win.localStorage.setItem(storageKey, value);} catch {}
    if (!cookie) return;
    const host = win.location.hostname;
    const domain = host === 'rishabhdoshi.com' || host.endsWith('.rishabhdoshi.com') ? '; Domain=.rishabhdoshi.com' : '';
    const secure = win.location.protocol === 'https:' ? '; Secure' : '';
    try {doc.cookie = `${encodeURIComponent(storageKey)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure}`;} catch {}
  }
  const followSystem = () => {if (mode === 'system') apply();};
  const followStorage = event => {
    if (event.key !== storageKey && event.key !== null) return;
    // The shared cookie is authoritative across sibling hosts. On this host,
    // the storage event carries the most recent explicit preference.
    mode = valid(event.newValue) ? event.newValue : cookiePreference() || 'system';
    apply();
  };
  media.addEventListener('change', followSystem);
  win.addEventListener('storage', followStorage);
  apply();
  return {
    getPreference: () => mode,
    getAppearance: () => state.appearance,
    setPreference(value) {validate(value); if (destroyed) return; mode = value; persist(value); apply();},
    subscribe(listener) {listeners.add(listener); return () => listeners.delete(listener);},
    refresh: apply,
    destroy() {destroyed = true; media.removeEventListener('change', followSystem); win.removeEventListener('storage', followStorage); listeners.clear();},
  };
}
