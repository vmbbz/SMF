// Centralized API routes so endpoint rotations are one-file changes.
export const API_ROUTES = Object.freeze({
  TRENDING: '/api/marketfeed/v2/trending-scan',
  GRADUATES: '/api/marketfeed/v2/graduate-scan',
  TOKEN_DETAILS: '/api/marketfeed/v2/token-scan',
});

export function tokenDetailsPath(mint) {
  return `${API_ROUTES.TOKEN_DETAILS}/${encodeURIComponent(mint)}`;
}
