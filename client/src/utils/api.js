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
