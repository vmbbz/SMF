// Centralized API route builder for web + Android WebView reliability.
const DEFAULT_NATIVE_API_ORIGIN = 'https://www.sticklash.fun';
const NATIVE_API_ORIGIN_FALLBACKS = [
  'https://sticklash.fun',
  'https://www.sticklash.fun',
  'https://smf-lzf3.onrender.com',
];

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
  const host = String(window.location?.hostname || '').toLowerCase();
  const protocol = String(window.location?.protocol || '').toLowerCase();
  const port = String(window.location?.port || '').toLowerCase();
  const ua = String(window.navigator?.userAgent || '').toLowerCase();
  if (protocol === 'capacitor:') return true;

  if (host === 'localhost' || host === '127.0.0.1') {
    // Keep local dev servers treated as web, but treat other localhost runtimes
    // (Capacitor embedded local server) as native for API origin routing.
    const localDevPorts = new Set(['3000', '4173', '5173', '5174', '4200', '8081']);
    if (localDevPorts.has(port)) return false;
    return true;
  }

  return ua.includes('capacitor') || ua.includes('; wv') || ua.includes(' version/4.0 ');
}

export function getApiBaseOrigin() {
  return isNativeWebView() ? getNativeApiOrigin() : '';
}

export function getApiBaseOrigins() {
  const primary = getApiBaseOrigin();
  if (!primary) return [''];

  const origins = [primary, ...NATIVE_API_ORIGIN_FALLBACKS]
    .map(normalizeOrigin)
    .filter(Boolean);
  return [...new Set(origins)];
}

export function apiUrl(path) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  const base = getApiBaseOrigin();
  return base ? `${base}${normalizedPath}` : normalizedPath;
}

export function apiUrlCandidates(path) {
  const normalizedPath = String(path || '').startsWith('/') ? String(path) : `/${path}`;
  return getApiBaseOrigins().map(base => (base ? `${base}${normalizedPath}` : normalizedPath));
}

export async function fetchFirstOk(paths, init) {
  const pathList = Array.isArray(paths) ? paths : [paths];
  const failures = [];

  for (const path of pathList) {
    for (const url of apiUrlCandidates(path)) {
      try {
        const response = await fetch(url, init);
        if (response.ok) return response;
        failures.push(`${url} -> HTTP ${response.status}`);
      } catch (error) {
        failures.push(`${url} -> ${error?.message || error}`);
      }
    }
  }

  throw new Error(failures.join(' | ') || 'No API endpoint responded');
}

export async function fetchApiJson(paths, init) {
  const response = await fetchFirstOk(paths, init);
  return response.json();
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
