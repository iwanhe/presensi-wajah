import { api, getConfig } from './api.js';
import { initFace, startCamera, readFace, bestMatch, similarity } from './face.js';
import { searchMembers, memberInfo } from './search.js';

const $ = (id) => document.getElementById(id);
const cfg = getConfig();
const video = $('camera');
const sampleBtns = [...document.querySelectorAll('.sample')];

const QUALITY = { score: 0.85, width: 0.3, real: 0.5, live: 0.5 };
const CAPTURE_MS = 4000;

let members = new Map();
let faceDb = [];
let faceOwner = [];
let picked = null;
let samples = {}; // sudut -> embedding
let latest = null; // hasil deteksi terakhir { f, t }
let ready = false;

const setStatus = (t) => { $('status').textContent = t; };
const setMsg = (t) => { $('msg').textContent = t; };

function goodFor(f, sudut) {
  if (!f || !f.embedding) return false;
  if (f.score < QUALITY.score || f.width < QUALITY.width) return false;
  if (f.real < QUALITY.real || f.live < QUALITY.live) return false;
  const yaw = Math.abs(f.yaw);
  return sudut === 'depan' ? yaw < 0.2 : yaw >= 0.15 && yaw <= 0.7;
}

function qualityText(f) {
  if (!f) return 'Wajah tidak terlihat';
  if (f.width < QUALITY.width) return 'Terlalu jauh — mendekat ke kamera';
  if (f.score < QUALITY.score) return 'Kurang jelas — periksa cahaya';
  if (f.real < QUALITY.real || f.live < QUALITY.live) return 'Terdeteksi seperti foto/layar — pakai wajah asli';
  return `Kualitas baik (arah wajah ${f.yaw >= 0 ? '+' : ''}${f.yaw.toFixed(2)})`;
}

// ---------- Data ----------
async function load() {
  if (!cfg || !cfg.apiUrl || !cfg.enrollToken) {
    setStatus('Token pendaftaran belum diisi. Buka Pengaturan dan isi ENROLL_TOKEN.');
    return false;
  }
  const d = await api('bootstrap', {}, { enroll: true });
  members = new Map(d.members.map((m) => [m.id, m]));
  faceDb = d.faces.map((f) => f.embedding);
  faceOwner = d.faces.map((f) => f.id);
  const withFace = new Set(faceOwner).size;
  setStatus(`${members.size} jemaat aktif · ${withFace} sudah terdaftar wajah`);
  return true;
}

// ---------- Cari & pilih jemaat ----------
$('q').addEventListener('input', () => {
  const ul = $('results');
  ul.innerHTML = '';
  for (const m of searchMembers(members, $('q').value)) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'result';
    b.innerHTML = '<strong></strong><span class="muted"></span>';
    b.querySelector('strong').textContent = m.nama;
    b.querySelector('span').textContent = `${m.id} · ${memberInfo(m)}${m.consent ? '' : ' · belum consent'}`;
    b.onclick = () => pick(m);
    li.appendChild(b);
    ul.appendChild(li);
  }
});

function faceCount(id) {
  return faceOwner.filter((o) => o === id).length;
}

function pick(m) {
  picked = m;
  samples = {};
  $('results').innerHTML = '';
  $('q').value = '';
  $('picked').hidden = false;
  $('pNama').textContent = m.nama;
  $('pInfo').textContent = `${m.id} · ${memberInfo(m)}`;
  const n = faceCount(m.id);
  $('pFaces').textContent = n ? `Sudah punya ${n} sampel wajah. Sampel baru akan ditambahkan.` : 'Belum punya sampel wajah.';
  $('pConsent').hidden = m.consent;
  $('btnDelete').hidden = n === 0;
  setMsg('');
  refreshButtons();
}

function refreshButtons() {
  const can = ready && picked && picked.consent;
  for (const b of sampleBtns) {
    b.disabled = !can;
    b.querySelector('span').textContent = samples[b.dataset.sudut] ? '✓' : '○';
    b.classList.toggle('done', !!samples[b.dataset.sudut]);
  }
  $('btnSave').disabled = !(can && samples.depan && samples.kiri && samples.kanan);
  $('btnTest').disabled = !ready;
}

// ---------- Kamera ----------
async function cameraLoop() {
  try {
    const f = await readFace(video);
    latest = { f, t: Date.now() };
    $('quality').textContent = qualityText(f);
  } catch (e) {
    console.warn(e);
  }
  setTimeout(cameraLoop, 350);
}

function waitForGood(sudut) {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (latest && latest.t > start && goodFor(latest.f, sudut)) return resolve(latest.f);
      if (Date.now() - start > CAPTURE_MS) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

for (const b of sampleBtns) {
  b.onclick = async () => {
    const sudut = b.dataset.sudut;
    b.disabled = true;
    setMsg(sudut === 'depan' ? 'Tatap lurus ke kamera…' : 'Putar kepala sedikit ke samping…');
    const f = await waitForGood(sudut);
    if (f) {
      samples[sudut] = Array.from(f.embedding);
      setMsg(`Sampel ${sudut} diambil.`);
    } else {
      setMsg(`Sampel ${sudut} belum memenuhi syarat. ${qualityText(latest?.f)}. Coba lagi.`);
    }
    refreshButtons();
  };
}

// ---------- Simpan ----------
$('btnSave').onclick = async () => {
  if (!picked) return;
  // Cek duplikat: apakah wajah depan mirip jemaat lain yang sudah terdaftar?
  const others = faceDb.map((e, i) => ({ e, id: faceOwner[i] })).filter((x) => x.id !== picked.id);
  let worst = null;
  for (const o of others) {
    const s = similarity(samples.depan, o.e);
    if (!worst || s > worst.s) worst = { s, id: o.id };
  }
  const thr = Number(cfg.threshold || 0.55);
  if (worst && worst.s >= thr) {
    const other = members.get(worst.id);
    const ok = confirm(`Wajah ini mirip dengan ${other ? other.nama : worst.id} (kemiripan ${worst.s.toFixed(2)}). ` +
      'Bisa terjadi pada saudara kembar. Tetap simpan?');
    if (!ok) return;
  }
  $('btnSave').disabled = true;
  setMsg('Menyimpan…');
  try {
    const list = ['depan', 'kiri', 'kanan'].map((sudut) => ({ sudut, embedding: samples[sudut] }));
    await api('enroll', { idJemaat: picked.id, petugas: cfg.deviceId, samples: list }, { enroll: true });
    for (const s of list) { faceDb.push(s.embedding); faceOwner.push(picked.id); }
    samples = {};
    pick(picked);
    setMsg(`Tersimpan untuk ${picked.nama}. Tekan "Uji kenali" atau minta mencoba di kiosk.`);
  } catch (e) {
    setMsg('Gagal menyimpan: ' + e.message);
  }
  refreshButtons();
};

// ---------- Uji kenali ----------
$('btnTest').onclick = async () => {
  const f = latest?.f;
  if (!f || !f.embedding) return setMsg('Tidak ada wajah di kamera.');
  const best = bestMatch(f.embedding, faceDb, faceOwner);
  const m = best.id ? members.get(best.id) : null;
  const thr = Number(cfg.threshold || 0.55);
  setMsg(m
    ? `Paling mirip: ${m.nama} (kemiripan ${best.similarity.toFixed(2)}, ${best.similarity >= thr ? 'DIKENALI' : 'di bawah threshold'})`
    : 'Belum ada wajah terdaftar.');
};

// ---------- Hapus data wajah (menarik persetujuan) ----------
$('btnDelete').onclick = async () => {
  if (!picked) return;
  if (!confirm(`Hapus SEMUA data wajah ${picked.nama}? Tindakan ini tidak bisa dibatalkan.`)) return;
  try {
    const r = await api('deleteFace', { idJemaat: picked.id }, { enroll: true });
    const keep = faceOwner.map((o, i) => o !== picked.id ? i : -1).filter((i) => i >= 0);
    faceDb = keep.map((i) => faceDb[i]);
    faceOwner = keep.map((i) => faceOwner[i]);
    pick(picked);
    setMsg(`${r.deleted} sampel dihapus. Ubah juga consent_wajah menjadi N di Google Sheet.`);
  } catch (e) {
    setMsg('Gagal menghapus: ' + e.message);
  }
};

// ---------- Mulai ----------
(async () => {
  try {
    if (!(await load())) return;
    setStatus($('status').textContent + ' · memuat model…');
    await Promise.all([initFace(), startCamera(video)]);
    ready = true;
    setStatus($('status').textContent.replace(' · memuat model…', ''));
    refreshButtons();
    cameraLoop();
  } catch (e) {
    console.error(e);
    setStatus('Gagal: ' + e.message);
  }
})();
