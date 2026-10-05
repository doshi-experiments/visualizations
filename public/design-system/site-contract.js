export const siteLinks = {
  home: {label: 'Home', href: 'https://rishabhdoshi.com/'},
  experiments: {label: 'Experiments', href: 'https://experiments.rishabhdoshi.com/'},
};
const titles = {portfolio:'Rishabh Doshi', experiments:'Experiments', visualizations:'Visualizations', calculator:'Calculators', game:'Mr. Shake', finance:'Finance', household:'Household'};
export function projectTitle(project) {return titles[project] || String(project || 'Rishabh Doshi');}
export const appearanceOptions = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
