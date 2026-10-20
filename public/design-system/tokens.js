// Single source for the shared identity, CSS, charts and non-JavaScript adapters.
// 0.6 "Felt": one identity for the portfolio and every app. Warm grey wool in light, charcoal in
// dark, one grotesk, and one signal. Surfaces are raised felt with a stitch; fields and tracks are
// pressed in. 0.7 deepens the signal from coral to a raspberry-to-brick gradient under white text.
// See docs/identity.md.
export const foundation = {
  'font-body': '"Host Grotesk", ui-sans-serif, system-ui, sans-serif',
  'font-display': '"Host Grotesk", ui-sans-serif, system-ui, sans-serif',
  'font-mono': '"Host Grotesk", ui-sans-serif, system-ui, sans-serif',
  // Host Grotesk has no flare or volume axes; these stay for consumers that still read them.
  'font-body-variation': 'normal',
  'font-display-variation': 'normal',
  'line-body': '1.55', 'measure': '64ch',
  'text-caption': '0.875rem', 'text-body': '1rem', 'text-card': '1.25rem',
  'text-section': '1.5625rem', 'text-title': '1.9375rem', 'text-large': '2.4375rem',
  'text-hero': '3.0625rem', 'text-display': 'clamp(2.4375rem, 5vw, 3.8125rem)',
  'space-1': '4px', 'space-2': '8px', 'space-3': '12px', 'space-4': '16px',
  'space-6': '24px', 'space-8': '32px', 'space-12': '48px',
  // Buttons, keys, chips and segments are pills; fields, selects, tracks and alerts are 14px.
  'radius-pill': '999px', 'radius-control': '14px', 'radius-container': '24px', 'radius-dialog': '30px',
  'duration-fast': '120ms', 'duration-base': '240ms', 'duration-slow': '480ms',
  'ease': 'cubic-bezier(.2,.7,.2,1)', 'ease-spring': 'cubic-bezier(.34,1.56,.64,1)', 'page-width': '1240px',
  // The signal: a subtle raspberry-to-brick gradient under white text. Both ends keep white at
  // 4.5:1 or better. action-primary is its solid midpoint for dots, accent-color, chart fills and
  // anything that cannot take a gradient. Hover and press deepen; lightening would lose the text.
  'action-text': '#FFFFFF',
  'action-gradient': 'linear-gradient(120deg, #D2386B 0%, #C8312F 100%)',
  'action-gradient-hover': 'linear-gradient(120deg, #C13462 0%, #B82D2B 100%)',
  'action-gradient-pressed': 'linear-gradient(120deg, #B5305C 0%, #AC2A28 100%)',
};
export const appearances = {
  light: {
    'text': '#262624', 'text-secondary': '#55524C', 'text-disabled': '#5F5B54', 'text-inverse': '#F1EEE9',
    'surface-page': '#E7E4DE', 'surface-raised': '#F1EEE9', 'surface-overlay': '#F6F4F0', 'surface-inset': '#DAD6CE',
    'border': '#77716A', 'selection': '#EAC9CA', 'stitch': 'rgba(38,38,36,.14)',
    'action-primary': '#CD354D', 'action-hover': '#BD3147', 'action-pressed': '#B02E42', 'action-link': '#A22826',
    'shadow-raised': 'inset 0 1px 0 rgba(255,255,255,.8), 0 0 0 1px rgba(38,38,36,.07), 0 10px 18px -12px rgba(38,38,36,.5)',
    'shadow-pressed': 'inset 0 2px 4px rgba(38,38,36,.22), inset 0 0 0 1px rgba(38,38,36,.06)',
    'shadow-overlay': '0 30px 60px -20px rgba(38,38,36,.45), 0 0 0 1px rgba(38,38,36,.08)',
    'success-bg': '#DCE6D3', 'success-text': '#2E5A29', 'success-icon': '#2E5A29',
    'warning-bg': '#F1E1B5', 'warning-text': '#6A4C00', 'warning-icon': '#6A4C00',
    'error-bg': '#F3D2CE', 'error-text': '#962620', 'error-icon': '#962620',
    'info-bg': '#D5E0E7', 'info-text': '#2B5876', 'info-icon': '#2B5876',
    'chart-1': '#262624', 'chart-2': '#C8312F', 'chart-3': '#3B7069', 'chart-4': '#8C6A22',
    'ramp-1': '#EAC9CA', 'ramp-2': '#E3A4AB', 'ramp-3': '#DB7B88', 'ramp-4': '#D25164', 'ramp-5': '#852232',
    // Retired with 0.6; kept for consumers that still name it. Meaningful progress, in mustard.
    'crane': '#8C6A22',
  },
  dark: {
    'text': '#ECE9E3', 'text-secondary': '#B9B4AA', 'text-disabled': '#AEA99F', 'text-inverse': '#262624',
    'surface-page': '#33322F', 'surface-raised': '#3E3D39', 'surface-overlay': '#3E3D39', 'surface-inset': '#2B2A27',
    'border': '#8E897F', 'selection': '#553C3C', 'stitch': 'rgba(236,233,227,.14)',
    'action-primary': '#CD354D', 'action-hover': '#BD3147', 'action-pressed': '#B02E42', 'action-link': '#E89D9C',
    'shadow-raised': 'inset 0 1px 0 rgba(255,255,255,.07), 0 0 0 1px rgba(236,233,227,.08), 0 12px 20px -12px rgba(0,0,0,.7)',
    'shadow-pressed': 'inset 0 3px 6px rgba(0,0,0,.4), inset 0 0 0 1px rgba(236,233,227,.06)',
    'shadow-overlay': '0 30px 60px -20px rgba(0,0,0,.7), 0 0 0 1px rgba(236,233,227,.12)',
    'success-bg': '#34442F', 'success-text': '#B7DCA9', 'success-icon': '#B7DCA9',
    'warning-bg': '#4A4026', 'warning-text': '#EBCB7C', 'warning-icon': '#EBCB7C',
    'error-bg': '#55302C', 'error-text': '#F4B3AC', 'error-icon': '#F4B3AC',
    'info-bg': '#2F4250', 'info-text': '#AFCDE3', 'info-icon': '#AFCDE3',
    'chart-1': '#ECE9E3', 'chart-2': '#E89D9C', 'chart-3': '#7FC1B8', 'chart-4': '#E2C27A',
    'ramp-1': '#5D3B3D', 'ramp-2': '#7E3942', 'ramp-3': '#A23747', 'ramp-4': '#E89D9C', 'ramp-5': '#F6D8D7',
    'crane': '#E2C27A',
  },
};
// One look for everything: every project resolves to the same palette. Project IDs stay so
// consumers keep their contract and a future project can diverge without a new API.
export const projectAppearanceOverrides = {};
export const projects = Object.fromEntries(
  ['portfolio', 'experiments', 'visualizations', 'calculator', 'game', 'finance', 'household']
    .map(project => [project, {light: appearances.light['action-primary'], dark: appearances.dark['action-primary'], radius: '24px'}]),
);
// control-compact-height (0.7.1) is the visible height of size="small" buttons and
// segmented controls; their hit area still covers control-target. Game never shrinks.
export const densities = {
  comfortable: {'control-height': '44px', 'control-target': '44px', 'control-compact-height': '36px', 'cell-padding': '12px', 'panel-padding': '24px'},
  compact: {'control-height': '44px', 'control-target': '44px', 'control-compact-height': '36px', 'cell-padding': '4px', 'panel-padding': '16px'},
  game: {'control-height': '60px', 'control-target': '60px', 'control-compact-height': '60px', 'cell-padding': '16px', 'panel-padding': '32px'},
};
export function resolveTokens({project = 'finance', appearance = 'light', density = 'comfortable'} = {}) {
  if (!Object.hasOwn(projects, project) || !Object.hasOwn(appearances, appearance) || !Object.hasOwn(densities, density)) throw new RangeError('Unknown theme dimension');
  const palette = {...appearances[appearance], ...projectAppearanceOverrides[project]?.[appearance]};
  return {...foundation, ...palette, ...densities[density],
    'focus': palette['action-link'],
    'amount-in': palette['success-text'], 'amount-out': palette['error-text']};
}
