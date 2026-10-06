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
    const isVideo = item.publicId.includes('/lecturettes/') || item.publicId.includes('/reviews/');
    const resourceType = isVideo ? 'video' : 'image';
    const ext = isVideo && !item.publicId.match(/\.(mp4|webm|mov|ogg)$/i) ? '.mp4' : '';
    return `https://res.cloudinary.com/bn8zsmom/${resourceType}/upload/${item.publicId}${ext}`;
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
 * Resolves the primary URL for a lecturette video.
 * Uses Cloudinary (with .mp4 transcode for universal browser compatibility and byte-range seeking)
 * or B2 proxy / Firebase / local upload as fallback.
 */
export function resolveLecturetteUrl(lec) {
  if (!lec) return '';
  // 1. Valid direct Cloudinary URL
  if (isValidCloudinaryUrl(lec.cloudinaryUrl)) return lec.cloudinaryUrl;
  // 2. Cloudinary via public ID with .mp4 extension for universal browser playback and seeking
  if (lec.publicId && isCloudinaryPublicId(lec.publicId)) {
    const cleanId = lec.publicId.replace(/\.(mp4|webm)$/i, '');
    return `https://res.cloudinary.com/bn8zsmom/video/upload/${cleanId}.mp4`;
  }
  // 3. Backblaze B2 proxy via backend
  if (lec.b2Key) {
    return apiUrl(`/api/media/${lec.b2Key.replace(/^\/+/, '')}`);
  }
  // 4. Firebase fallback
  if (lec.firebaseUrl && lec.firebaseUrl.startsWith('http')) return lec.firebaseUrl;
  // 5. Local uploads fallback
  if (lec.url) return apiUrl(lec.url);
  return '';
}

/**
 * Resolves an ordered list of candidate URLs for a lecturette video.
 * Used by CustomVideoPlayer to gracefully fall back if the primary source fails.
 */
export function resolveLecturetteSources(lec) {
  if (!lec) return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  // 1. Cloudinary MP4 (universal compatibility & seeking support)
  if (lec.publicId && isCloudinaryPublicId(lec.publicId)) {
    const cleanId = lec.publicId.replace(/\.(mp4|webm)$/i, '');
    add(`https://res.cloudinary.com/bn8zsmom/video/upload/${cleanId}.mp4`);
    add(`https://res.cloudinary.com/bn8zsmom/video/upload/${cleanId}.webm`);
  }

  // 2. Direct Cloudinary URL
  if (isValidCloudinaryUrl(lec.cloudinaryUrl)) {
    add(lec.cloudinaryUrl);
    if (lec.cloudinaryUrl.includes('.webm')) {
      add(lec.cloudinaryUrl.replace('.webm', '.mp4'));
    }
  }

  // 3. Backblaze B2 proxy
  if (lec.b2Key) {
    add(apiUrl(`/api/media/${lec.b2Key.replace(/^\/+/, '')}`));
  }

  // 4. Firebase Storage
  if (lec.firebaseUrl && lec.firebaseUrl.startsWith('http')) {
    add(lec.firebaseUrl);
  }

  // 5. Local uploads fallback
  if (lec.url) {
    add(apiUrl(lec.url));
  }

  return urls;
}

/**
 * Resolves the best available URL for a GPE map image.
 * Priority: backend B2 proxy → Cloudinary mapUrl → Cloudinary publicId → primary mapUrl (/uploads/...)
 */
export function resolveGpeMapUrl(gpe) {
  if (!gpe) return '';
  if (gpe.mapB2Key) return apiUrl(`/api/media/${gpe.mapB2Key.replace(/^\/+/, '')}`);
  if (gpe.mapUrl && gpe.mapUrl.startsWith('http')) return gpe.mapUrl;
  if (gpe.mapPublicId && isCloudinaryPublicId(gpe.mapPublicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.mapPublicId}`;
  }
  if (gpe.mapUrl) return apiUrl(gpe.mapUrl);
  if (gpe.mapGridFsId && gpe.mapGridFsId !== 'null') {
    return apiUrl(`/api/media/gridfs/${gpe.mapGridFsId}`);
  }
  return '';
}

/**
 * Returns an ordered array of fallback URLs for a GPE map.
 */
export function resolveGpeMapSources(gpe) {
  if (!gpe) return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  if (gpe.mapB2Key) add(apiUrl(`/api/media/${gpe.mapB2Key.replace(/^\/+/, '')}`));
  if (gpe.mapUrl) add(apiUrl(gpe.mapUrl));
  if (gpe.mapPublicId && isCloudinaryPublicId(gpe.mapPublicId)) {
    add(`https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.mapPublicId}`);
  }
  if (gpe.mapGridFsId && gpe.mapGridFsId !== 'null') {
    add(apiUrl(`/api/media/gridfs/${gpe.mapGridFsId}`));
  }
  return urls;
}

/**
 * Resolves the best available URL for a GPE narrative image.
 * Priority: backend B2 proxy → Cloudinary narrativeImageUrl → Cloudinary publicId → primary narrativeImageUrl (/uploads/...)
 */
export function resolveGpeNarrativeUrl(gpe) {
  if (!gpe) return '';
  if (gpe.narrativeB2Key) return apiUrl(`/api/media/${gpe.narrativeB2Key.replace(/^\/+/, '')}`);
  if (gpe.narrativeImageUrl && gpe.narrativeImageUrl.startsWith('http')) return gpe.narrativeImageUrl;
  if (gpe.narrativePublicId && isCloudinaryPublicId(gpe.narrativePublicId)) {
    return `https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.narrativePublicId}`;
  }
  if (gpe.narrativeImageUrl) return apiUrl(gpe.narrativeImageUrl);
  if (gpe.narrativeGridFsId && gpe.narrativeGridFsId !== 'null') {
    return apiUrl(`/api/media/gridfs/${gpe.narrativeGridFsId}`);
  }
  return '';
}

/**
 * Returns an ordered array of fallback URLs for a GPE narrative image.
 */
export function resolveGpeNarrativeSources(gpe) {
  if (!gpe) return [];
  const urls = [];
  const seen = new Set();
  const add = (u) => {
    if (u && !seen.has(u)) {
      seen.add(u);
      urls.push(u);
    }
  };

  if (gpe.narrativeB2Key) add(apiUrl(`/api/media/${gpe.narrativeB2Key.replace(/^\/+/, '')}`));
  if (gpe.narrativeImageUrl) add(apiUrl(gpe.narrativeImageUrl));
  if (gpe.narrativePublicId && isCloudinaryPublicId(gpe.narrativePublicId)) {
    add(`https://res.cloudinary.com/bn8zsmom/image/upload/${gpe.narrativePublicId}`);
  }
  if (gpe.narrativeGridFsId && gpe.narrativeGridFsId !== 'null') {
    add(apiUrl(`/api/media/gridfs/${gpe.narrativeGridFsId}`));
  }
  return urls;
}

/**
 * Resolves the best available URL for a GPE candidate solution photo.
 * Priority: direct URL / blob / data → Cloudinary publicId → backend B2 proxy → solutionImageUrl
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
  if (sol.solutionB2Key) return apiUrl(`/api/media/${sol.solutionB2Key.replace(/^\/+/, '')}`);
  if (sol.solutionImageUrl) return apiUrl(sol.solutionImageUrl);
  return '';
}
