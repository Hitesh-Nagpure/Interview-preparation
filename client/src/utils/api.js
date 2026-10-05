const isLocalDev = typeof window !== 'undefined' && 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

export const API_BASE = (
  import.meta.env.VITE_API_URL || 
  (isLocalDev ? 'http://localhost:5000' : 'https://ssb-psych-prep.onrender.com')
).replace(/\/+$/, '');

/**
 * Returns true only if the string is a real Cloudinary public ID (e.g. ssb-psych-prep/...)
 * Local filenames like 'gpe-map-123.jpg' are NOT Cloudinary IDs.
 */
export function isCloudinaryPublicId(pid) {
  return typeof pid === 'string' && pid.startsWith('ssb-psych-prep/');
}

/**
 * Returns full URL for an API path.
 * In production, routes to https://ssb-psych-prep.onrender.com unless VITE_API_URL overrides it.
 * In local dev, routes to http://localhost:5000 or relative proxy.
 *
 * @param {string} path - e.g. '/api/folders'
 * @returns {string}
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
 * Priority: cloudinaryUrl (fast, public CDN) → firebaseUrl → apiUrl(url) → server B2 proxy
 *
 * @param {object} item - The DB item (pic, lec, gpe, etc.)
 * @param {string} urlField - Fallback url field (default: 'url')
 * @returns {string}
 */
export function resolveMediaUrl(item, urlField = 'url') {
  if (!item) return '';
  // 1. Cloudinary CDN (fastest, public, permanent)
  if (item.cloudinaryUrl && item.cloudinaryUrl.startsWith('http')) return item.cloudinaryUrl;
  if (item.publicId && isCloudinaryPublicId(item.publicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${item.publicId}`;
  }
  // 2. Firebase Storage URL
  if (item.firebaseUrl && item.firebaseUrl.startsWith('http')) return item.firebaseUrl;
  // 3. Fall back to the primary url field routed through backend API (handles /uploads/...)
  if (item[urlField]) return apiUrl(item[urlField]);
  // 4. Backblaze B2 streamed via backend proxy (avoids 401 on private bucket)
  if (item.b2Key) {
    return apiUrl(`/api/media/${item.b2Key.replace(/^\/+/, '')}`);
  }
  return '';
}

/**
 * Resolves the best available URL for a GPE map image.
 * Priority: Cloudinary mapUrl → Cloudinary publicId → primary mapUrl (/uploads/...) → backend B2 proxy
 */
export function resolveGpeMapUrl(gpe) {
  if (!gpe) return '';
  if (gpe.mapUrl && gpe.mapUrl.startsWith('http')) return gpe.mapUrl;
  if (gpe.mapPublicId && isCloudinaryPublicId(gpe.mapPublicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.mapPublicId}`;
  }
  if (gpe.mapUrl) return apiUrl(gpe.mapUrl);
  if (gpe.mapB2Key) return apiUrl(`/api/media/${gpe.mapB2Key.replace(/^\/+/, '')}`);
  return '';
}

/**
 * Resolves the best available URL for a GPE narrative image.
 */
export function resolveGpeNarrativeUrl(gpe) {
  if (!gpe) return '';
  if (gpe.narrativeImageUrl && gpe.narrativeImageUrl.startsWith('http')) return gpe.narrativeImageUrl;
  if (gpe.narrativePublicId && isCloudinaryPublicId(gpe.narrativePublicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.narrativePublicId}`;
  }
  if (gpe.narrativeImageUrl) return apiUrl(gpe.narrativeImageUrl);
  if (gpe.narrativeB2Key) return apiUrl(`/api/media/${gpe.narrativeB2Key.replace(/^\/+/, '')}`);
  return '';
}

/**
 * Resolves the best available URL for a GPE candidate solution photo.
 */
export function resolveGpeSolutionUrl(sol) {
  if (!sol) return '';
  if (
    sol.solutionImageUrl &&
    (sol.solutionImageUrl.startsWith('http') ||
      sol.solutionImageUrl.startsWith('blob:') ||
      sol.solutionImageUrl.startsWith('data:'))
  ) {
    return sol.solutionImageUrl;
  }
  if (sol.solutionPublicId && isCloudinaryPublicId(sol.solutionPublicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${sol.solutionPublicId}`;
  }
  if (sol.solutionImageUrl) return apiUrl(sol.solutionImageUrl);
  if (sol.solutionB2Key) return apiUrl(`/api/media/${sol.solutionB2Key.replace(/^\/+/, '')}`);
  return '';
}
