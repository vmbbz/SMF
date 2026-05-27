// Centralized API route builder for web + Android WebView reliability.
const DEFAULT_NATIVE_API_ORIGIN = 'https://sticklash.fun';

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getNativeApiOrigin() {
  if (typeof window === 'undefined') return DEFAULT_NATIVE_API_ORIGIN;

  const explicit = normalizeOrigin(
    window.__SMF_API_ORIGIN ||
      window.__SMF_NATIVE_BACKEND_ORIGIN ||
      window.__SMF_PUBLIC_ORIGIN ||
      window.__SMF_SHARE_ORIGIN
  );
  if (explicit) return explicit;
  return DEFAULT_NATIVE_API_ORIGIN;
}

function isNativeWebView() {
  if (typeof window === 'undefined') return false;
  if (window.Capacitor) return true;
  const protocol = String(window.location?.protocol || '').toLowerCase();
  return protocol === 'capacitor:';
}

export function getApiBaseOrigin() {
  return isNativeWebView() ? getNativeApiOrigin() : '';
}

export function apiUrl(path) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const base = getApiBaseOrigin();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export const API_ROUTES = Object.freeze({
  TRENDING: '/api/marketfeed/v2/trending-scan',
  GRADUATES: '/api/marketfeed/v2/graduate-scan',
  TOKEN_DETAILS: '/api/marketfeed/v2/token-scan',
  LEGACY_TRENDING: '/api/trending',
  LEGACY_GRADUATES: '/api/graduates',
});

export function tokenDetailsPath(mint) {
  return apiUrl(`${API_ROUTES.TOKEN_DETAILS}/${encodeURIComponent(mint)}`);
}
