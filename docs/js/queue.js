// Antrean presensi di tablet (IndexedDB). Presensi selalu disimpan di sini dulu,
// lalu dikirim per batch ke Google Sheet. WiFi putus tidak menghentikan antrean.
import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/+esm';
import { api } from './api.js';

const KEY = 'antrean';
const BATCH = 50;
let sending = false;
let onChange = () => {};

export async function pending() {
  return (await get(KEY)) || [];
}

export async function enqueue(item) {
  const q = await pending();
  q.push(item);
  await set(KEY, q);
  onChange(q.length);
  flush(); // coba kirim langsung, tidak perlu ditunggu
}

export async function flush() {
  if (sending || !navigator.onLine) return;
  sending = true;
  try {
    let q = await pending();
    while (q.length) {
      const batch = q.slice(0, BATCH);
      await api('checkinBatch', { items: batch });
      const sent = new Set(batch.map((i) => i.uuid));
      q = (await pending()).filter((i) => !sent.has(i.uuid)); // hapus hanya yang sudah terkirim
      await set(KEY, q);
      onChange(q.length);
    }
  } catch (e) {
    console.warn('Kirim gagal, dicoba lagi nanti:', e.message);
  } finally {
    sending = false;
  }
}

export function startSync(changeCallback) {
  if (changeCallback) onChange = changeCallback;
  pending().then((q) => onChange(q.length));
  setInterval(flush, 15000); // tiap 15 detik
  window.addEventListener('online', flush);
  flush();
}
