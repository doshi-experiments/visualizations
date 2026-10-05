// Single source for the shared identity, CSS, charts and non-JavaScript adapters.
export const foundation = {
  'font-body': '"Commissioner", ui-sans-serif, system-ui, sans-serif',
  'font-display': '"Commissioner", ui-sans-serif, system-ui, sans-serif',
  'font-mono': '"Commissioner", ui-sans-serif, system-ui, sans-serif',
  'font-body-variation': '"FLAR" 0, "VOLM" 0, "slnt" 0',
  'font-display-variation': '"FLAR" 22, "VOLM" 0, "slnt" 0',
  'line-body': '1.55', 'measure': '64ch',
  'text-caption': '0.875rem', 'text-body': '1rem', 'text-card': '1.25rem',
  'text-section': '1.5625rem', 'text-title': '1.9375rem', 'text-large': '2.4375rem',
  'text-hero': '3.0625rem', 'text-display': 'clamp(2.4375rem, 5vw, 3.8125rem)',
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px',
  'space-6': '24px', 'space-8': '32px', 'space-12': '48px',
  'radius-control': '8px', 'radius-container': '16px', 'radius-dialog': '20px',
  'duration-fast': '120ms', 'duration-base': '240ms', 'duration-slow': '480ms',
  'ease': 'cubic-bezier(.2,.75,.25,1)', 'page-width': '1240px',
  'shadow-raised': 'none', 'shadow-overlay': '0 20px 64px #17323D30',
  'crane': '#E7BD45',
};
export const appearances = {
  light: {
    'text': '#17323D', 'text-secondary': '#49626D', 'text-disabled': '#5A717B', 'text-inverse': '#FFFFFF',
    'surface-page': '#F1F5F7', 'surface-raised': '#FFFFFF', 'surface-overlay': '#FFFFFF',
    'border': '#758892', 'selection': '#D3EAF4',
    'success-bg': '#E0F2E9', 'success-text': '#185940', 'success-icon': '#185940',
    'warning-bg': '#FFF3CE', 'warning-text': '#6B5000', 'warning-icon': '#6B5000',
    'error-bg': '#FCE7E7', 'error-text': '#982F38', 'error-icon': '#982F38',
    'info-bg': '#DFEEF6', 'info-text': '#1B5D8A', 'info-icon': '#1B5D8A',
    'chart-1': '#1B5D8A', 'chart-2': '#2A7C77', 'chart-3': '#B15A2B', 'chart-4': '#617A86',
    'ramp-1': '#DFEEF6', 'ramp-2': '#A8D7EB', 'ramp-3': '#6DA9CA', 'ramp-4': '#1B5D8A', 'ramp-5': '#17323D',
  },
  dark: {
    'text': '#F1F5F7', 'text-secondary': '#C0D1D8', 'text-disabled': '#A7BDC6', 'text-inverse': '#17323D',
    'surface-page': '#17323D', 'surface-raised': '#23414C', 'surface-overlay': '#2B4A55',
    'border': '#82A2AD', 'selection': '#345D70',
    'success-bg': '#224D3F', 'success-text': '#A9E0C6', 'success-icon': '#A9E0C6',
    'warning-bg': '#4A4021', 'warning-text': '#F3D78A', 'warning-icon': '#F3D78A',
    'error-bg': '#542F38', 'error-text': '#F3B6BC', 'error-icon': '#F3B6BC',
    'info-bg': '#2A4E65', 'info-text': '#A8D7EB', 'info-icon': '#A8D7EB',
    'chart-1': '#A8D7EB', 'chart-2': '#81C9BD', 'chart-3': '#F0B17B', 'chart-4': '#BDCDD4',
    'ramp-1': '#23414C', 'ramp-2': '#1B5D8A', 'ramp-3': '#6DA9CA', 'ramp-4': '#A8D7EB', 'ramp-5': '#DFEEF6',
  },
};
// One recognizable identity. Project IDs remain compatible with existing apps.
export const projects = Object.fromEntries(
  ['portfolio', 'experiments', 'visualizations', 'calculator', 'game', 'finance', 'household']
    .map(project => [project, {light: '#1B5D8A', dark: '#A8D7EB', radius: '16px'}]),
);
export const densities = {
  comfortable: {'control-height': '44px', 'control-target': '44px', 'cell-padding': '12px', 'panel-padding': '24px'},
  compact: {'control-height': '44px', 'control-target': '44px', 'cell-padding': '4px', 'panel-padding': '16px'},
  game: {'control-height': '60px', 'control-target': '60px', 'cell-padding': '16px', 'panel-padding': '32px'},
};
function shade(hex, amount, light) {
  return '#' + hex.slice(1).match(/../g).map(v => Math.round(parseInt(v, 16) * (1 - amount) + (light ? 255 : 0) * amount).toString(16).padStart(2, '0')).join('');
}
export function resolveTokens({project = 'finance', appearance = 'light', density = 'comfortable'} = {}) {
  if (!Object.hasOwn(projects, project) || !Object.hasOwn(appearances, appearance) || !Object.hasOwn(densities, density)) throw new RangeError('Unknown theme dimension');
  const brand = projects[project][appearance];
  return {...foundation, ...appearances[appearance], ...densities[density],
    'action-primary': brand, 'action-hover': shade(brand, .12, appearance === 'dark'), 'action-pressed': shade(brand, .22, appearance === 'dark'),
    'action-text': appearances[appearance]['text-inverse'], 'focus': brand,
    'amount-in': appearances[appearance]['success-text'], 'amount-out': appearances[appearance]['error-text']};
}
