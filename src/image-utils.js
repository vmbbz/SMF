import { apiUrl } from './api-endpoints.js';

const LOCAL_IMAGE_PREFIXES = [
  'data:',
  'blob:',
  'assets/',
  './assets/',
  '../assets/',
  '/',
];

function normalizeImageUrl(value) {
  return String(value || '').trim();
}

export function isRemoteImageUrl(value) {
  const url = normalizeImageUrl(value).toLowerCase();
  return url.startsWith('http://') || url.startsWith('https://');
}

export function isLocalImageUrl(value) {
  const url = normalizeImageUrl(value);
  if (!url) return false;
  return LOCAL_IMAGE_PREFIXES.some(prefix => url.startsWith(prefix));
}

export function proxiedImageUrl(value, { cacheBust = false } = {}) {
  const url = normalizeImageUrl(value);
  if (!url) return 'assets/smf-logo.png';
  if (!isRemoteImageUrl(url)) return url;

  const proxyPath = `/api/proxy/image?url=${encodeURIComponent(url)}${cacheBust ? `&t=${Date.now()}` : ''}`;
  return apiUrl(proxyPath);
}

export function getTokenImageSource(token, fallback = 'assets/smf-logo.png') {
  if (!token) return fallback;
  return (
    token.logoURI ||
    token.logoUri ||
    token.logo ||
    token.image ||
    token.icon ||
    fallback
  );
}

export function getTokenCoverSource(token, fallback = '') {
  if (!token) return fallback;
  return (
    token.coverImage ||
    token.headerImage ||
    token.bannerImage ||
    token.banner ||
    token.header ||
    token.openGraphImage ||
    token.openGraph ||
    token.info?.header ||
    token.info?.openGraph ||
    token.pairs?.[0]?.info?.header ||
    token.pairs?.[0]?.info?.openGraph ||
    fallback
  );
}

export function loadImage(src, { crossOrigin = true } = {}) {
  return new Promise((resolve, reject) => {
    const url = normalizeImageUrl(src);
    if (!url) {
      reject(new Error('Image URL is empty'));
      return;
    }

    const img = new Image();
    if (crossOrigin && !url.startsWith('data:') && !url.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Unable to load image: ${url}`));
    img.src = url;
  });
}

export async function loadGameImage(value, options = {}) {
  const url = normalizeImageUrl(value);
  if (!url) return loadImage('assets/smf-logo.png', { crossOrigin: false });

  if (!isRemoteImageUrl(url)) {
    return loadImage(url, { crossOrigin: false });
  }

  // First choice: same-origin proxy, safe for canvas capture. Last resort:
  // direct load without CORS so fighters still render even if a remote host/proxy blips.
  const attempts = [
    { src: proxiedImageUrl(url, options), crossOrigin: true },
    { src: url, crossOrigin: false },
  ];

  let lastError = null;
  for (const attempt of attempts) {
    try {
      return await loadImage(attempt.src, { crossOrigin: attempt.crossOrigin });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to load image: ${url}`);
}

if (typeof window !== 'undefined') {
  window.smfProxiedImageUrl = proxiedImageUrl;
}
