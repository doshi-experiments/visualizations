// Single source for CSS, JS charts, and non-JavaScript theme adapters.
export const foundation = {
  'font-body': '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
  'font-display': '"Hanken Grotesk", ui-sans-serif, system-ui, sans-serif',
  'font-mono': 'ui-monospace, SFMono-Regular, Consolas, monospace',
  'text-caption': '0.875rem', 'text-body': '1rem', 'text-card': '1.25rem',
  'text-section': '1.5rem', 'text-title': '2.25rem', 'text-display': 'clamp(3rem, 8vw, 7rem)',
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px',
  'space-6': '24px', 'space-8': '32px', 'space-12': '48px',
  'radius-control': '12px', 'radius-container': '24px',
  'duration-fast': '160ms', 'duration-base': '320ms', 'duration-slow': '640ms',
  'ease': 'cubic-bezier(.2,.75,.25,1)', 'page-width': '1240px',
  'shadow-raised': '0 8px 28px #00000012', 'shadow-overlay': '0 20px 64px #00000030',
};
export const appearances = {
  light: {
    'text': '#202332', 'text-secondary': '#50576b', 'text-disabled': '#62697a', 'text-inverse': '#ffffff',
    'surface-page': '#f6f7fb', 'surface-raised': '#ffffff', 'surface-overlay': '#ffffff',
    'border': '#7d8495', 'selection': '#e2deff',
    'success-bg': '#e0f5e9', 'success-text': '#145c38', 'success-icon': '#145c38',
    'warning-bg': '#fff1d4', 'warning-text': '#714500', 'warning-icon': '#714500',
    'error-bg': '#ffe5eb', 'error-text': '#9b1939', 'error-icon': '#9b1939',
    'info-bg': '#e2eeff', 'info-text': '#194b8a', 'info-icon': '#194b8a',
    'chart-1': '#643ac9', 'chart-2': '#087e8b', 'chart-3': '#b34b12', 'chart-4': '#bb2766',
    'ramp-1': '#eee9ff', 'ramp-2': '#c9b9ff', 'ramp-3': '#9974ee', 'ramp-4': '#643ac9', 'ramp-5': '#38206f',
  },
  dark: {
    'text': '#f3f4fa', 'text-secondary': '#b8c0d4', 'text-disabled': '#9da6ba', 'text-inverse': '#171925',
    'surface-page': '#131521', 'surface-raised': '#202433', 'surface-overlay': '#292e40',
    'border': '#7b849d', 'selection': '#41355f',
    'success-bg': '#183e2d', 'success-text': '#99e9b6', 'success-icon': '#99e9b6',
    'warning-bg': '#44361b', 'warning-text': '#ffdc90', 'warning-icon': '#ffdc90',
    'error-bg': '#481f31', 'error-text': '#ffb1c5', 'error-icon': '#ffb1c5',
    'info-bg': '#203957', 'info-text': '#accfff', 'info-icon': '#accfff',
    'chart-1': '#bd9fff', 'chart-2': '#60d5df', 'chart-3': '#ffb680', 'chart-4': '#ff93c3',
    'ramp-1': '#38206f', 'ramp-2': '#643ac9', 'ramp-3': '#9974ee', 'ramp-4': '#c9b9ff', 'ramp-5': '#eee9ff',
  },
};
// Colors are provisional identities; status colors never derive from branding.
export const projects = {
  portfolio: {light: '#6536c5', dark: '#c4a7ff', radius: '24px'},
  experiments: {light: '#a52b72', dark: '#fface0', radius: '28px'},
  visualizations: {light: '#076d83', dark: '#70d5eb', radius: '16px'},
  calculator: {light: '#116b55', dark: '#7ee2bf', radius: '20px'},
  game: {light: '#b92e4a', dark: '#ffa4b6', radius: '32px'},
  finance: {light: '#4e46b8', dark: '#b9b2ff', radius: '16px'},
  household: {light: '#6551b8', dark: '#c3b6ff', radius: '24px'},
};
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
    'radius-container': projects[project].radius,
    'amount-in': appearances[appearance]['success-text'], 'amount-out': appearances[appearance]['error-text']};
}
