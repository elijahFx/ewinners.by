/**
 * Yandex.Disk REST API client.
 *
 * Env:
 *   YANDEX_DISK_TOKEN  — OAuth token (never commit)
 *   YANDEX_DISK_ROOT   — root folder name, default ewinners.by
 */
import fs from 'fs';

const API = 'https://cloud-api.yandex.net/v1/disk';

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim();
}

export function yandexDiskConfig() {
  const token = env('YANDEX_DISK_TOKEN');
  const root = env('YANDEX_DISK_ROOT', 'ewinners.by').replace(/^\/+|\/+$/g, '');
  return {
    token,
    root,
    configured: Boolean(token),
    rootPath: `disk:/${root}`,
  };
}

function authHeaders() {
  const { token } = yandexDiskConfig();
  if (!token) throw new Error('YANDEX_DISK_TOKEN не задан');
  return { Authorization: `OAuth ${token}` };
}

function diskPath(...parts) {
  const { root } = yandexDiskConfig();
  const segs = [root, ...parts]
    .flatMap((p) => String(p || '').split('/'))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/[\\:*?"<>|]+/g, '_'));
  return `disk:/${segs.join('/')}`;
}

async function apiRequest(method, urlPath, { query: qs = {}, body, raw = false } = {}) {
  const url = new URL(urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`);
  for (const [k, v] of Object.entries(qs)) {
    if (v == null || v === '') continue;
    url.searchParams.set(k, String(v));
  }

  const headers = { ...authHeaders(), Accept: 'application/json' };
  let payload;
  if (body != null && !(body instanceof Buffer) && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else {
    payload = body;
  }

  const res = await fetch(url, { method, headers, body: payload });
  if (raw) return res;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!res.ok) {
    const err = new Error(
      data?.message || data?.description || data?.error || `Yandex Disk HTTP ${res.status}`,
    );
    err.status = res.status;
    err.code = data?.error || null;
    err.data = data;
    throw err;
  }
  return data;
}

/** Create folder; ignore if already exists. */
export async function ensureFolder(remotePath) {
  try {
    await apiRequest('PUT', '/resources', { query: { path: remotePath } });
    return { created: true, path: remotePath };
  } catch (err) {
    if (err.status === 409 || err.code === 'DiskPathPointsToExistentDirectoryError') {
      return { created: false, path: remotePath };
    }
    throw err;
  }
}

/** Ensure nested path exists (disk:/a/b/c). */
export async function ensurePath(remotePath) {
  const normalized = String(remotePath).replace(/^disk:\//, '').replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);
  let cur = 'disk:';
  for (const part of parts) {
    cur = `${cur}/${part}`;
    await ensureFolder(cur);
  }
  return remotePath.startsWith('disk:') ? remotePath : `disk:/${normalized}`;
}

export async function uploadBuffer(remotePath, buffer, { overwrite = true, contentType } = {}) {
  const parent = remotePath.replace(/\/[^/]+$/, '');
  if (parent && parent.startsWith('disk:/') && parent.length > 'disk:/'.length) {
    await ensurePath(parent);
  }

  const link = await apiRequest('GET', '/resources/upload', {
    query: { path: remotePath, overwrite: overwrite ? 'true' : 'false' },
  });
  if (!link?.href) throw new Error('Yandex Disk: нет ссылки для загрузки');

  const headers = {};
  if (contentType) headers['Content-Type'] = contentType;

  const putRes = await fetch(link.href, {
    method: 'PUT',
    headers,
    body: buffer,
  });
  if (!putRes.ok) {
    const t = await putRes.text().catch(() => '');
    throw new Error(`Yandex Disk upload failed HTTP ${putRes.status}: ${t.slice(0, 200)}`);
  }
  return { path: remotePath, status: putRes.status };
}

export async function uploadLocalFile(localPath, remotePath, { overwrite = true } = {}) {
  if (!localPath || !fs.existsSync(localPath)) {
    throw new Error(`Локальный файл не найден: ${localPath}`);
  }
  const buf = fs.readFileSync(localPath);
  return uploadBuffer(remotePath, buf, { overwrite });
}

export async function uploadText(remotePath, text, { overwrite = true } = {}) {
  return uploadBuffer(remotePath, Buffer.from(String(text), 'utf8'), {
    overwrite,
    contentType: 'text/plain; charset=utf-8',
  });
}

export async function uploadJson(remotePath, obj, { overwrite = true } = {}) {
  return uploadBuffer(remotePath, Buffer.from(JSON.stringify(obj, null, 2), 'utf8'), {
    overwrite,
    contentType: 'application/json; charset=utf-8',
  });
}

export function paths() {
  const root = diskPath();
  return {
    root,
    documents: diskPath('documents'),
    chat: diskPath('chat'),
    chatConversations: diskPath('chat', 'conversations'),
    diskPath,
  };
}

export async function ensureRootTree() {
  const cfg = yandexDiskConfig();
  if (!cfg.configured) {
    return { ok: false, message: 'YANDEX_DISK_TOKEN не задан' };
  }
  const p = paths();
  await ensurePath(p.root);
  await ensurePath(p.documents);
  await ensurePath(p.chat);
  await ensurePath(p.chatConversations);
  return { ok: true, root: p.root };
}

export { diskPath };
