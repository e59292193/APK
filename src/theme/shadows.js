// Shadow tokens. iOS shadow* + Android elevation kept in sync.
// Avoid purple glow, heavy shadows, or per-card elevation.

export const shadows = {
  none: {
    shadowOpacity: 0,
    elevation: 0,
  },
  soft: {
    shadowColor: '#4A365D',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
  },
  medium: {
    shadowColor: '#4A365D',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.10,
    shadowRadius: 16,
    elevation: 4,
  },
  floating: {
    shadowColor: '#7655B4',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.20,
    shadowRadius: 18,
    elevation: 7,
  },
};

export default shadows;
