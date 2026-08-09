const API_BASE = (import.meta.env.VITE_API_URL || 'https://test.zkh.by').replace(/\/$/, '');

function getToken() {
  return localStorage.getItem('ew_token') || '';
}

export function setToken(token) {
  if (token) localStorage.setItem('ew_token', token);
  else localStorage.removeItem('ew_token');
}

export async function api(path, options = {}) {
  const headers = {
    ...(options.body && !(options.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers || {}),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
    body:
      options.body && typeof options.body === 'object' && !(options.body instanceof FormData)
        ? JSON.stringify(options.body)
        : options.body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export function downloadUrl(path) {
  const token = getToken();
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  // browser download with auth header needs fetch blob; helpers use apiDownload
  return { url: url.toString(), token };
}

export async function apiDownload(path, filename) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error('Не удалось скачать файл');
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'download';
  a.click();
  URL.revokeObjectURL(a.href);
}
