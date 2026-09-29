// Existing apps own preference storage and stamping. Observe their stamp only.
(() => {
  const root = document.documentElement;
  function update() {
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta);}
    meta.content = getComputedStyle(root).getPropertyValue('--ds-surface-page').trim();
  }
  new MutationObserver(update).observe(root, {attributes:true, attributeFilter:['data-theme','data-project']});
  update();
})();
