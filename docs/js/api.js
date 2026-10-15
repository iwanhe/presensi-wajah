// Konfigurasi perangkat disimpan di localStorage tablet (diisi lewat setup.html).
const KEY = 'presensi.config';

export const DEFAULTS = { apiUrl: '', token: '', enrollToken: '', deviceId: '', threshold: 0.55 };

export function getConfig() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null');
    return c ? { ...DEFAULTS, ...c } : null;
  } catch {
    return null;
  }
}

export function saveConfig(c) {
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULTS, ...c }));
}

/**
 * Panggil API Apps Script.
 * Content-Type text/plain dipakai agar browser tidak mengirim CORS preflight,
 * yang tidak didukung web app Apps Script.
 */
export async function api(action, payload = {}, { enroll = false, timeoutMs = 30000 } = {}) {
  const cfg = getConfig();
  if (!cfg || !cfg.apiUrl) throw new Error('Perangkat belum diatur. Buka setup.html.');
  const token = enroll ? cfg.enrollToken : cfg.token;
  if (!token) throw new Error(enroll ? 'Token pendaftaran belum diisi di setup.html.' : 'Token belum diisi di setup.html.');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token, deviceId: cfg.deviceId, ...payload }),
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'API error');
    return data;
  } finally {
    clearTimeout(timer);
  }
}
