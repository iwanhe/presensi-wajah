import { api, getConfig, saveConfig, DEFAULTS } from './api.js';
import { pending, flush } from './queue.js';

const f = document.getElementById('f');
const msg = document.getElementById('msg');
const cfg = getConfig() || DEFAULTS;
for (const [k, v] of Object.entries(cfg)) if (f.elements[k]) f.elements[k].value = v;

function read() {
  const d = Object.fromEntries(new FormData(f));
  d.apiUrl = d.apiUrl.trim();
  d.token = d.token.trim();
  d.enrollToken = d.enrollToken.trim();
  d.deviceId = d.deviceId.trim();
  d.threshold = Number(d.threshold) || DEFAULTS.threshold;
  return d;
}

f.onsubmit = (e) => {
  e.preventDefault();
  saveConfig(read());
  msg.textContent = 'Tersimpan.';
};

document.getElementById('btnTest').onclick = async () => {
  saveConfig(read());
  msg.textContent = 'Menghubungi API…';
  try {
    const d = await api('bootstrap');
    const ev = d.event ? `${d.event.id_kegiatan} — ${d.event.nama}` : 'tidak ada kegiatan aktif hari ini';
    msg.textContent = `Berhasil. ${d.members.length} jemaat aktif, ${d.faces.length} sampel wajah. Kegiatan: ${ev}.`;
  } catch (e) {
    msg.textContent = 'Gagal: ' + e.message;
  }
};

function stats() {
  let st = {};
  try { st = JSON.parse(localStorage.getItem('presensi.stats') || '{}'); } catch {}
  const w = st.konfirmasiWajah || 0;
  const b = st.bukan || 0;
  document.getElementById('stWajah').textContent = w;
  document.getElementById('stBukan').textContent = b;
  document.getElementById('stRate').textContent = w ? ((b / w) * 100).toFixed(1) + '%' : '-';
  pending().then((q) => { document.getElementById('stQueue').textContent = q.length; });
}
stats();

document.getElementById('btnResetStats').onclick = () => {
  if (!confirm('Reset statistik tablet ini?')) return;
  localStorage.removeItem('presensi.stats');
  stats();
};
document.getElementById('btnFlush').onclick = async () => {
  await flush();
  stats();
};
