// Animation timing tokens (ms).
// Keep transitions in the 120–250ms range. Celebration overlays excepted.

export const durations = {
  fast: 120,
  quick: 150,
  base: 200,
  slow: 250,
  // Sheet / modal entrance
  enter: 250,
  exit: 200,
};

export const easings = {
  // React Native Animated accepts named presets via easing module in code;
  // these strings are kept for documentation / future use.
  standard: 'ease-in-out',
  enter: 'ease-out',
  exit: 'ease-in',
};

export const animations = {
  durations,
  easings,
  // Common press feedback
  pressOpacity: 0.6,
  pressScale: 0.97,
};

export default animations;
