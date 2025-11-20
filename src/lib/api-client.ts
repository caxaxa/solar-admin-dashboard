const API_BASE = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.replace(/\/$/, '') || '';

export function buildApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}
