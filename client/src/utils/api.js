const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
  window.location.port === '3000';

export const API_BASE = (import.meta.env.VITE_API_URL || (isLocalDev ? 'http://localhost:5000' : '')).replace(/\/+$/, '');

/**
 * Returns full URL for an API path.
 * If VITE_API_URL is configured, prepends the backend origin.
 * Otherwise, returns the relative path (working with Vite proxy or local server).
 *
 * @param {string} path - e.g. '/api/folders'
 * @returns {string} - e.g. 'https://backend.onrender.com/api/folders' or '/api/folders'
 */
export function apiUrl(path) {
  if (!path) return '';
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:') ||
    path.startsWith('data:')
  ) {
    return path;
  }
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${cleanPath}` : cleanPath;
}

/**
 * Resolves the best available media URL for a stored media item.
 * Priority: b2Url (permanent Backblaze CDN) → cloudinaryUrl → firebaseUrl → apiUrl(url)
 *
 * Use this for any TAT image, GPE map, lecturette video, or other stored file
 * to ensure it works in production where local disk is ephemeral.
 *
 * @param {object} item - The DB item (pic, lec, gpe, etc.)
 * @param {string} urlField - Which URL field to fall back to (default: 'url')
 * @param {string} b2UrlField - Which b2Url field to check (default: 'b2Url')
 * @returns {string}
 */
export function resolveMediaUrl(item, urlField = 'url', b2UrlField = 'b2Url') {
  if (!item) return '';
  // 1. Permanent Backblaze public URL (best — never expires, no auth needed)
  if (item[b2UrlField] && item[b2UrlField].startsWith('http')) return item[b2UrlField];
  // 2. Cloudinary CDN (permanent, but may be deleted if quota exceeded)
  if (item.cloudinaryUrl && item.cloudinaryUrl.startsWith('http')) return item.cloudinaryUrl;
  // 3. Firebase Storage URL (permanent)
  if (item.firebaseUrl && item.firebaseUrl.startsWith('http')) return item.firebaseUrl;
  // 4. Fall back to the primary url field (works locally, may fail in production if disk is ephemeral)
  return apiUrl(item[urlField] || '');
}

/**
 * Resolves the best available URL for a GPE map image.
 * Priority: b2Url via mapB2Key → Cloudinary mapUrl → apiUrl(mapUrl)
 */
export function resolveGpeMapUrl(gpe) {
  if (!gpe) return '';
  // Build b2Url from mapB2Key if not stored directly
  if (gpe.mapB2Key) {
    const b2Url = buildB2Url(gpe.mapB2Key);
    if (b2Url) return b2Url;
  }
  if (gpe.mapUrl && gpe.mapUrl.startsWith('http')) return gpe.mapUrl;
  return apiUrl(gpe.mapUrl || '');
}

/**
 * Resolves the best available URL for a GPE narrative image.
 */
export function resolveGpeNarrativeUrl(gpe) {
  if (!gpe) return '';
  if (gpe.narrativeB2Key) {
    const b2Url = buildB2Url(gpe.narrativeB2Key);
    if (b2Url) return b2Url;
  }
  if (gpe.narrativeImageUrl && gpe.narrativeImageUrl.startsWith('http')) return gpe.narrativeImageUrl;
  return apiUrl(gpe.narrativeImageUrl || '');
}

/**
 * Resolves the best available URL for a GPE candidate solution photo.
 */
export function resolveGpeSolutionUrl(sol) {
  if (!sol) return '';
  if (sol.solutionB2Key) {
    const b2Url = buildB2Url(sol.solutionB2Key);
    if (b2Url) return b2Url;
  }
  if (sol.solutionImageUrl && sol.solutionImageUrl.startsWith('http')) return sol.solutionImageUrl;
  return apiUrl(sol.solutionImageUrl || '');
}

/**
 * Builds a Backblaze B2 public URL from an object key.
 * Bucket: ssb-prep-data-2100, region: us-east-005
 */
function buildB2Url(key) {
  if (!key) return '';
  const bucket = 'ssb-prep-data-2100';
  const cleanKey = key.replace(/^\/+/, '');
  return `https://f005.backblazeb2.com/file/${bucket}/${cleanKey}`;
}
