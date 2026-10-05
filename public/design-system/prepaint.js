// Plain, synchronous script: load in <head> before the stylesheets.
(() => {
  const root = document.documentElement;
  const key = root.dataset.appearanceStorage || 'sheet-theme';
  const valid = value => ['system', 'light', 'dark'].includes(value);
  let preference;
  if (root.dataset.appearanceCookie !== 'false') {
    try {
      const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(encodeURIComponent(key) + '='));
      const value = item && decodeURIComponent(item.slice(item.indexOf('=') + 1));
      if (valid(value)) preference = value;
    } catch {}
  }
  if (!preference) {
    try {const value = localStorage.getItem(key); if (valid(value)) preference = value;} catch {}
  }
  preference ||= 'system';
  const appearance = preference === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : preference;
  root.dataset.appearancePreference = preference;
  root.dataset.theme = appearance;
  root.style.colorScheme = appearance;
})();
