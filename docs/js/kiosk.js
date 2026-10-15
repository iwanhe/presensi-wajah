import { api, getConfig } from './api.js';
import { initFace, startCamera, stopCamera, readFace, bestMatch, lastDetectMs, backendName } from './face.js';
import { enqueue, startSync } from './queue.js';
import { searchMembers, memberInfo } from './search.js';
import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6.3.0/+esm';

// ---------- Pengaturan perilaku ----------
const LOOP_MS = 250;          // jeda minimum antar deteksi ringan
const IDLE_LOOP_MS = 700;     // jeda saat tidak ada orang (hemat baterai & CPU)
const FULL_EVERY_MS = 600;    // pengenalan wajah (berat) paling sering tiap 600 ms
const MISS_MS = 3000;         // wajah tidak dikenali selama ini → buka Cari Nama
const CONFIRM_MS = 8000;      // konfirmasi batal otomatis
const SUCCESS_MS = 2200;      // lama pesan "Selamat datang"
const IDLE_MS = 60000;        // layar cari/tamu kembali ke kamera jika ditinggal
const MIN_FACE_WIDTH = 0.22;  // wajah harus cukup dekat
const MIN_SCORE = 0.75;
const MIN_REAL = 0.5;         // anti-spoof (foto/layar)
const MIN_LIVE = 0.5;

const cfg = getConfig();
const $ = (id) => document.getElementById(id);
const video = $('camera');

let members = new Map();
let faceDb = [];
let faceOwner = [];
let event = null;
let state = 'loading';
let missSince = null;
let pauseUntil = 0;
let timer = null;
let pendingConfirm = null; // { member, metode, similarity }

// ---------- Layar ----------
const SCREENS = ['loading', 'error', 'scan', 'confirm', 'search', 'guest', 'qr', 'success'];
function show(name) {
  state = name;
  clearTimeout(timer);
  for (const s of SCREENS) $('scr-' + s).hidden = s !== name;
}
function fail(msg) {
  $('errMsg').textContent = msg;
  show('error');
}

// ---------- Sudah absen (disimpan per kegiatan di tablet) ----------
const doneKey = () => 'presensi.done.' + (event?.id_kegiatan || '');
function doneSet() {
  try { return new Set(JSON.parse(localStorage.getItem(doneKey()) || '[]')); } catch { return new Set(); }
}
function markDone(id) {
  const s = doneSet(); s.add(id);
  localStorage.setItem(doneKey(), JSON.stringify([...s]));
}

// ---------- Statistik untuk menyetel threshold (dilihat di setup.html) ----------
function bump(key) {
  const k = 'presensi.stats';
  let st = {};
  try { st = JSON.parse(localStorage.getItem(k) || '{}'); } catch {}
  st[key] = (st[key] || 0) + 1;
  localStorage.setItem(k, JSON.stringify(st));
}

// ---------- Boot ----------
function applyData(d) {
  members = new Map(d.members.map((m) => [m.id, m]));
  faceDb = d.faces.map((f) => f.embedding);
  faceOwner = d.faces.map((f) => f.id);
  event = d.event;
  $('eventName').textContent = event ? event.nama : 'Presensi';
  $('eventDate').textContent = event
    ? `${event.tanggal} · ${event.jam_mulai || ''}${event.jam_selesai ? '–' + event.jam_selesai : ''}`
    : '';
}

async function boot() {
  show('loading');
  if (!cfg || !cfg.apiUrl || !cfg.token) {
    location.href = 'setup.html';
    return;
  }
  const status = (t) => { $('loadMsg').textContent = t; };
  try {
    status('Mengambil data jemaat…');
    let d;
    try {
      d = await api('bootstrap');
      await set('bootstrap', d);
    } catch (e) {
      d = await get('bootstrap'); // offline: pakai data terakhir
      if (!d) throw new Error('Belum ada data. Sambungkan internet sekali, lalu coba lagi.');
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
      if (d.event && d.event.tanggal !== today) d = { ...d, event: null };
    }
    applyData(d);
    if (!event) return fail('Tidak ada kegiatan aktif hari ini. Periksa tab Kegiatan (tanggal hari ini, aktif = Y).');

    await initFace(status);
    status('Menyalakan kamera…');
    await startCamera(video);
    startSync((n) => {
      const b = $('queueBadge');
      b.hidden = n === 0;
      b.textContent = `${n} belum terkirim`;
    });
    show('scan');
    loop();
  } catch (e) {
    console.error(e);
    fail(e.message || String(e));
  }
}

// ---------- Loop deteksi wajah ----------
let lastFull = 0;
let lastSeen = 0;
const DEBUG = new URLSearchParams(location.search).has('debug');

async function loop() {
  const t0 = performance.now();
  try {
    if (state === 'scan' && Date.now() > pauseUntil) await tick();
  } catch (e) {
    console.warn(e);
  }
  // Jeda adaptif: beri waktu layar/tombol merespons. Makin lambat perangkat, makin lebar jedanya.
  const busy = performance.now() - t0;
  const idle = Date.now() - lastSeen > 5000;
  const wait = Math.min(1500, Math.max(idle ? IDLE_LOOP_MS : LOOP_MS, busy * 1.5));
  if (DEBUG) $('scanHint').dataset.debug = `${backendName()} · ${Math.round(lastDetectMs)} ms · jeda ${Math.round(wait)} ms`;
  setTimeout(loop, wait);
}

async function tick() {
  const hint = $('scanHint');
  // Tahap 1: deteksi ringan, hanya mencari kotak wajah
  const quick = await readFace(video, { full: false });
  if (state !== 'scan') return;
  if (!quick) { missSince = null; hint.textContent = 'Silakan lihat ke kamera'; return; }
  lastSeen = Date.now();
  if (quick.width < MIN_FACE_WIDTH) { missSince = null; hint.textContent = 'Mendekat sedikit ke kamera'; return; }
  if (Date.now() - lastFull < FULL_EVERY_MS) return;

  // Tahap 2: pengenalan penuh, hanya saat wajah cukup dekat
  lastFull = Date.now();
  const f = await readFace(video, { full: true });
  if (state !== 'scan') return;
  if (!f || f.score < MIN_SCORE || !f.embedding) { hint.textContent = 'Tahan sebentar…'; return; }

  missSince ??= Date.now();
  const genuine = f.real >= MIN_REAL && f.live >= MIN_LIVE;
  const best = bestMatch(f.embedding, faceDb, faceOwner);
  const m = best.id ? members.get(best.id) : null;

  if (genuine && m && best.similarity >= Number(cfg.threshold || 0.55)) {
    missSince = null;
    openConfirm(m, 'wajah', best.similarity);
    return;
  }
  hint.textContent = genuine ? 'Mengenali wajah…' : 'Wajah kurang jelas, hadap lurus ke kamera';
  if (Date.now() - missSince > MISS_MS) {
    missSince = null;
    openSearch();
  }
}

// ---------- Konfirmasi ----------
function openConfirm(member, metode, sim) {
  if (doneSet().has(member.id)) return success(member.nama, 'Anda sudah tercatat hadir. Terima kasih!');
  pendingConfirm = { member, metode, similarity: sim };
  $('cNama').textContent = member.nama;
  $('cInfo').textContent = memberInfo(member);
  show('confirm');
  if (metode === 'wajah') bump('konfirmasiWajah');
  timer = setTimeout(backToScan, CONFIRM_MS);
}

$('btnYes').onclick = async () => {
  const p = pendingConfirm;
  if (!p) return backToScan();
  pendingConfirm = null;
  await record(p.member, p.metode, p.similarity);
};

$('btnNo').onclick = () => {
  if (pendingConfirm?.metode === 'wajah') bump('bukan');
  pendingConfirm = null;
  openSearch();
};

async function record(member, metode, sim) {
  await enqueue({
    uuid: crypto.randomUUID(),
    waktu: new Date().toISOString(),
    idKegiatan: event.id_kegiatan,
    idJemaat: member.id,
    nama: member.nama,
    metode, // wajah | cari | qr | tamu
    similarity: sim ? Number(sim).toFixed(3) : '',
    hadirSebagai: 'Peserta',
  });
  markDone(member.id);
  success(`Selamat datang, ${member.nama}!`, 'Kehadiran Anda sudah tercatat.');
}

function success(title, sub) {
  $('sMsg').textContent = title;
  $('sSub').textContent = sub || '';
  show('success');
  timer = setTimeout(backToScan, SUCCESS_MS);
}

function backToScan() {
  pendingConfirm = null;
  missSince = null;
  pauseUntil = Date.now() + 1500; // jeda singkat agar orang yang sama sempat bergeser
  $('scanHint').textContent = 'Silakan lihat ke kamera';
  show('scan');
}

// ---------- Cari nama / tanggal lahir ----------
const q = $('q');
function openSearch() {
  q.value = '';
  renderResults();
  show('search');
  idle();
}
function idle() {
  clearTimeout(timer);
  timer = setTimeout(backToScan, IDLE_MS);
}
function renderResults() {
  const ul = $('results');
  ul.innerHTML = '';
  const list = searchMembers(members, q.value);
  if (q.value.trim().length >= 3 && !list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Tidak ditemukan. Coba ketik sebagian nama.';
    ul.appendChild(li);
  }
  for (const m of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.className = 'result';
    b.innerHTML = '<strong></strong><span class="muted"></span>';
    b.querySelector('strong').textContent = m.nama;
    b.querySelector('span').textContent = memberInfo(m);
    b.onclick = () => openConfirm(m, 'cari');
    li.appendChild(b);
    ul.appendChild(li);
  }
}
q.addEventListener('input', () => { renderResults(); idle(); });

// keypad angka besar untuk DDMMYY (lebih mudah bagi lansia)
const keypad = $('keypad');
['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Hapus', '0', '⌫'].forEach((k) => {
  const b = document.createElement('button');
  b.className = 'key';
  b.textContent = k;
  b.onclick = () => {
    if (k === '⌫') q.value = q.value.slice(0, -1);
    else if (k === 'Hapus') q.value = '';
    else q.value += k;
    renderResults();
    idle();
  };
  keypad.appendChild(b);
});
$('btnSearch').onclick = openSearch;
$('btnSearchBack').onclick = backToScan;

// ---------- Tamu ----------
$('btnGuest').onclick = () => {
  $('guestName').value = '';
  show('guest');
  idle();
};
$('guestName').addEventListener('input', idle);
$('btnGuestBack').onclick = openSearch;
$('btnGuestSave').onclick = async () => {
  const nama = $('guestName').value.trim();
  if (nama.length < 3) { $('guestName').focus(); return; }
  await record({ id: 'TAMU-' + crypto.randomUUID().slice(0, 8), nama }, 'tamu');
};

// ---------- QR (opsional) ----------
let qr = null;
function loadQrLib() {
  if (window.__Html5QrcodeLibrary__) return Promise.resolve();
  return new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
    s.onload = ok;
    s.onerror = () => err(new Error('Pustaka QR gagal dimuat'));
    document.head.appendChild(s);
  });
}
$('btnQr').onclick = async () => {
  show('qr');
  try {
    await loadQrLib();
    stopCamera(video); // kamera dipakai bergantian
    qr = new window.__Html5QrcodeLibrary__.Html5Qrcode('qrReader');
    await qr.start({ facingMode: 'user' }, { fps: 8, qrbox: 260 }, async (text) => {
      const id = String(text).trim();
      await stopQr();
      const m = members.get(id);
      if (m) openConfirm(m, 'qr');
      else success('QR tidak dikenal', 'Silakan pakai Cari Nama.');
    });
    timer = setTimeout(() => $('btnQrBack').click(), IDLE_MS);
  } catch (e) {
    console.error(e);
    await stopQr();
    fail('Scan QR gagal: ' + e.message);
  }
};
async function stopQr() {
  if (qr) {
    try { await qr.stop(); qr.clear(); } catch {}
    qr = null;
  }
  if (!video.srcObject) await startCamera(video);
}
$('btnQrBack').onclick = async () => { await stopQr(); backToScan(); };

// ---------- Lain-lain ----------
$('btnRetry').onclick = () => location.reload();
setInterval(() => {
  $('clock').textContent = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}, 1000);
// muat ulang otomatis setelah 6 jam (saat layar sedang di kamera) agar browser tidak melambat
const startedAt = Date.now();
setInterval(() => {
  if (state === 'scan' && Date.now() - startedAt > 6 * 60 * 60 * 1000) location.reload();
}, 60000);

boot();
