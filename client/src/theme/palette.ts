// Central design tokens for a warm "hospitality" identity (the app manages a
// restaurant/bar's staff) — deep wine/burgundy instead of a generic SaaS
// blue. Consumed both by the antd ConfigProvider theme (contexts/color-mode)
// and by pages that need raw hex values directly (avatars, charts, icons).

export const palette = {
  primary: '#9F1239', // deep wine/burgundy
  success: '#15803D', // present / approved
  warning: '#D97706', // late / pending
  error: '#DC2626', // absent / rejected
  info: '#0891B2', // neutral highlight (pending counts, etc.)
  leave: '#7C3AED', // on-leave, kept distinct from the above
};

// For distinguishing many items at a glance (avatars, position chips) — six
// distinct hues at similar saturation/lightness so no one item stands out
// unfairly.
export const categorical = ['#9F1239', '#0F766E', '#B45309', '#4338CA', '#15803D', '#BE185D'];

export const surface = {
  light: '#FAF9F7',
  dark: '#1C1917',
};

// Softer/less-saturated take on the primary wine tone, used for large washes
// (the login background) where the full-strength `primary` reads as too intense.
export const loginGradient = 'linear-gradient(135deg, #3D2B28 0%, #6B3B42 55%, #A8525B 100%)';
