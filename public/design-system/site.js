import {createAppearanceController} from './theme.js';
import {siteLinks, projectTitle, appearanceOptions} from './site-contract.js';
let nextLabel = 0;
// Static sites get the same structure, labels and control as React consumers.
export function mountSiteHeader(element, {project = element.ownerDocument.documentElement.dataset.project || 'portfolio', controller} = {}) {
  const doc = element.ownerDocument;
  const ownsController = !controller;
  controller ||= createAppearanceController({root:doc.documentElement, storageKey:doc.documentElement.dataset.appearanceStorage || 'sheet-theme', cookie:doc.documentElement.dataset.appearanceCookie !== 'false'});
  const header = doc.createElement('header'); header.className = 'ds-site-header';
  const nav = doc.createElement('nav'); nav.className = 'ds-site-navigation'; nav.setAttribute('aria-label', 'Global navigation');
  for (const [name, link] of Object.entries(siteLinks)) {
    const anchor = doc.createElement('a'); anchor.className = 'ds-site-link'; anchor.href = link.href; anchor.textContent = link.label;
    if ((name === 'home' && project === 'portfolio') || (name === 'experiments' && project === 'experiments')) anchor.setAttribute('aria-current', 'page');
    nav.append(anchor);
  }
  const title = doc.createElement('span'); title.className = 'ds-site-project'; title.textContent = projectTitle(project);
  const label = doc.createElement('label'); label.className = 'ds-appearance';
  const text = doc.createElement('span'); text.className = 'ds-appearance-label'; text.id = `ds-appearance-label-${++nextLabel}`; text.textContent = 'Appearance';
  const select = doc.createElement('select'); select.className = 'ds-appearance-select'; select.setAttribute('aria-labelledby', text.id);
  for (const [value, caption] of appearanceOptions) {const option = doc.createElement('option'); option.value = value; option.textContent = caption; select.append(option);}
  select.value = controller.getPreference();
  const change = () => controller.setPreference(select.value);
  select.addEventListener('change', change);
  const unsubscribe = controller.subscribe(state => {select.value = state.preference;});
  label.append(text, select); header.append(nav, title, label); element.replaceChildren(header);
  return {controller, destroy() {unsubscribe(); select.removeEventListener('change', change); header.remove(); if (ownsController) controller.destroy();}};
}
