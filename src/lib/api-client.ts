import { isTokenExpired, refreshAccessToken } from './auth';

const API_BASE = process.env.NEXT_PUBLIC_ADMIN_API_BASE_URL?.replace(/\/$/, '') || '';

export function buildApiUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${normalizedPath}`;
}

async function getValidToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  let token = localStorage.getItem('accessToken');
  if (!token) return null;

  if (isTokenExpired(token)) {
    token = await refreshAccessToken();
    if (!token) {
      // Refresh failed — clear auth and redirect to login
      localStorage.clear();
      window.location.href = '/login';
      return null;
    }
  }

  return token;
}

export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const token = await getValidToken();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string> || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  return fetch(input, { ...init, headers });
}
