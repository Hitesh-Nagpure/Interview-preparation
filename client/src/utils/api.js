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
 * Returns true only if the cloudinaryUrl looks like a valid, complete Cloudinary URL.
 * A truncated URL like 'https://res.cloudinary.com/bn8zsmom/image/upload/v1790864099' 
 * (missing the actual filename/public_id) is treated as invalid.
 */
function isValidCloudinaryUrl(url) {
  if (!url || typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  if (!url.includes('cloudinary.com')) return false;
  // Must have something after /upload/vXXXX/ or /upload/
  const uploadIdx = url.indexOf('/upload/');
  if (uploadIdx === -1) return false;
  const afterUpload = url.slice(uploadIdx + 8); // after "/upload/"
  if (!afterUpload || afterUpload.trim() === '') return false;
  // Check if it's just a version number with nothing after (broken truncated URL)
  // e.g. 'v1790864099' alone with no path segment after it
  if (/^v\d+\/?$/.test(afterUpload.split('?')[0])) return false;
  return true;
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
 * Priority: cloudinaryUrl (valid) → publicId (Cloudinary CDN) → firebaseUrl → b2Key proxy → url field → empty
 *
 * @param {object} item - The DB item (pic, lec, gpe, etc.)
 * @param {string} urlField - Fallback url field (default: 'url')
 * @returns {string}
 */
export function resolveMediaUrl(item, urlField = 'url') {
  if (!item) return '';
  // 1. Cloudinary CDN — only when the URL is complete and valid (not truncated)
  if (isValidCloudinaryUrl(item.cloudinaryUrl)) return item.cloudinaryUrl;
  // 2. Cloudinary via public ID (only genuine ssb-psych-prep/ prefixed IDs)
  if (item.publicId && isCloudinaryPublicId(item.publicId)) {
    // Lecturette and review videos use /video/upload/, everything else uses /image/upload/
    const resourceType = (item.publicId.includes('/lecturettes/') || item.publicId.includes('/reviews/')) ? 'video' : 'image';
    return `https://res.cloudinary.com/bn8zsmom/${resourceType}/upload/${item.publicId}`;
  }
  // 3. Firebase Storage URL
  if (item.firebaseUrl && item.firebaseUrl.startsWith('http')) return item.firebaseUrl;
  // 4. Backblaze B2 via backend proxy (avoids 401 on private bucket)
  if (item.b2Key) {
    return apiUrl(`/api/media/${item.b2Key.replace(/^\/+/, '')}`);
  }
  // 5. Fall back to the primary url field routed through backend API (handles /uploads/...)
  if (item[urlField]) return apiUrl(item[urlField]);
  return '';
}

/**
 * Resolves the best URL for a lecturette video, always preferring B2 proxy
 * over Cloudinary. Cloudinary does not properly support HTTP Range requests
 * for seeking in WebM videos — the browser gets a 200 (full stream) instead
 * of a 206 (partial), causing the video to restart from the beginning.
 * B2 via our backend proxy (/api/media/...) correctly returns 206 Partial Content.
 */
export function resolveLecturetteUrl(lec) {
  if (!lec) return '';
  // Always prefer B2 proxy for seeking support
  if (lec.b2Key) {
    return apiUrl(`/api/media/${lec.b2Key.replace(/^\/+/, '')}`);
  }
  // Firebase fallback
  if (lec.firebaseUrl && lec.firebaseUrl.startsWith('http')) return lec.firebaseUrl;
  // Cloudinary last resort (seeking won't work well but at least it plays)
  if (isValidCloudinaryUrl(lec.cloudinaryUrl)) return lec.cloudinaryUrl;
  if (lec.publicId && isCloudinaryPublicId(lec.publicId)) {
    return `https://res.cloudinary.com/bn8zsmom/video/upload/${lec.publicId}`;
  }
  // Local uploads fallback
  if (lec.url) return apiUrl(lec.url);
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
