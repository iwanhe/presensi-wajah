/**
 * Presensi Wajah — API Google Apps Script
 *
 * Web app ini hanya API (JSON). Tampilan kiosk ada di folder /docs (GitHub Pages),
 * karena web app Apps Script tidak bisa mengakses kamera.
 *
 * Script Properties yang wajib diisi (Project Settings → Script Properties):
 *   API_TOKEN    — token untuk tablet kiosk
 *   ENROLL_TOKEN — token khusus petugas pendaftaran wajah (harus berbeda dari API_TOKEN)
 *
 * Aksi (semua lewat POST, body JSON dikirim sebagai text/plain):
 *   bootstrap    — data awal kiosk: jemaat aktif, embedding wajah, kegiatan hari ini
 *   checkinBatch — simpan presensi per batch (duplikat diabaikan)
 *   enroll       — simpan sampel wajah (hanya ENROLL_TOKEN)
 *   deleteFace   — hapus semua sampel wajah seorang jemaat (hanya ENROLL_TOKEN)
 */

const SS = SpreadsheetApp.getActive();
const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Jakarta';
const MAX_BATCH = 100;

function doGet() {
  return json_({ ok: true, service: 'presensi-wajah', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    const p = JSON.parse(e.postData.contents);
    const props = PROPS.getProperties(); // satu kali baca per request, hemat kuota
    const isEnroll = !!p.token && !!props.ENROLL_TOKEN && p.token === props.ENROLL_TOKEN;
    const isKiosk = !!p.token && !!props.API_TOKEN && p.token === props.API_TOKEN;
    if (!isEnroll && !isKiosk) return json_({ ok: false, error: 'unauthorized' });
    if (['enroll', 'deleteFace'].includes(p.action) && !isEnroll) {
      return json_({ ok: false, error: 'forbidden' });
    }
    switch (p.action) {
      case 'bootstrap': return json_(bootstrap_());
      case 'checkinBatch': return json_(checkinBatch_(p));
      case 'enroll': return json_(enroll_(p));
      case 'deleteFace': return json_(deleteFace_(p));
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    log_('ERROR', String((err && err.stack) || err));
    return json_({ ok: false, error: 'server error' });
  }
}

function bootstrap_() {
  const members = readSheet_('Jemaat')
    .filter((m) => m.aktif === 'Y')
    .map((m) => ({
      id: m.id_jemaat,
      nama: m.nama,
      jk: m.jenis_kelamin,
      kategori: m.kategori,
      wilayah: m.wilayah,
      tglLahir: m.tgl_lahir,
      consent: m.consent_wajah === 'Y',
    }));
  const consented = new Set(members.filter((m) => m.consent).map((m) => m.id));
  const faces = readSheet_('Wajah')
    .filter((f) => consented.has(f.id_jemaat)) // wajah tanpa persetujuan aktif tidak dikirim
    .map((f) => ({ id: f.id_jemaat, sudut: f.sudut, embedding: JSON.parse(f.embedding) }));
  return { ok: true, members, faces, event: activeEvent_(), serverTime: new Date().toISOString() };
}

function activeEvent_() {
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  const ev = readSheet_('Kegiatan').find((k) => k.aktif === 'Y' && k.tanggal === today);
  return ev || null;
}

function checkinBatch_(p) {
  const items = (p.items || []).slice(0, MAX_BATCH);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // satu penulis dalam satu waktu
  try {
    const sh = SS.getSheetByName('Presensi');
    const values = sh.getDataRange().getDisplayValues();
    const seen = new Set(values.slice(1).map((r) => r[1] + '|' + r[2])); // id_kegiatan|id_jemaat
    const seenUuid = new Set(values.slice(1).map((r) => r[8]));
    const rows = [];
    let duplicate = 0;
    for (const it of items) {
      if (!it || !it.idKegiatan || !it.idJemaat || !it.uuid) continue;
      const key = it.idKegiatan + '|' + it.idJemaat;
      if (seen.has(key) || seenUuid.has(it.uuid)) { duplicate++; continue; }
      seen.add(key);
      seenUuid.add(it.uuid);
      rows.push([
        new Date(it.waktu),
        it.idKegiatan,
        it.idJemaat,
        String(it.nama || '').slice(0, 120),
        it.metode,
        it.similarity || '',
        String(p.deviceId || '').slice(0, 40),
        it.hadirSebagai || 'Peserta',
        it.uuid,
      ]);
    }
    if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    return { ok: true, received: items.length, saved: rows.length, duplicate };
  } finally {
    lock.releaseLock();
  }
}

function enroll_(p) {
  const member = readSheet_('Jemaat').find((m) => m.id_jemaat === p.idJemaat);
  if (!member) return { ok: false, error: 'jemaat tidak ditemukan' };
  if (member.consent_wajah !== 'Y') return { ok: false, error: 'belum ada persetujuan data wajah' };
  const now = new Date();
  const rows = (p.samples || [])
    .filter((s) => Array.isArray(s.embedding) && s.embedding.length > 0)
    .map((s) => [
      p.idJemaat,
      JSON.stringify(s.embedding.map((v) => Math.round(v * 10000) / 10000)), // 4 desimal, hemat ruang
      s.sudut,
      String(p.petugas || '').slice(0, 40),
      now,
    ]);
  if (!rows.length) return { ok: false, error: 'tidak ada sampel' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SS.getSheetByName('Wajah');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, saved: rows.length };
}

function deleteFace_(p) {
  if (!p.idJemaat) return { ok: false, error: 'idJemaat kosong' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SS.getSheetByName('Wajah');
    const last = sh.getLastRow();
    if (last < 2) return { ok: true, deleted: 0 };
    const ids = sh.getRange(1, 1, last, 1).getDisplayValues().flat();
    let deleted = 0;
    for (let i = ids.length - 1; i >= 1; i--) { // dari bawah agar nomor baris tidak bergeser
      if (ids[i] === p.idJemaat) { sh.deleteRow(i + 1); deleted++; }
    }
    return { ok: true, deleted };
  } finally {
    lock.releaseLock();
  }
}

function readSheet_(name) {
  const sh = SS.getSheetByName(name);
  if (!sh) throw new Error('Tab tidak ditemukan: ' + name);
  const [header, ...rows] = sh.getDataRange().getDisplayValues();
  return rows
    .filter((r) => r[0] !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [String(h).trim(), String(r[i]).trim()])));
}

function log_(level, msg) {
  try {
    SS.getSheetByName('Log').appendRow([new Date(), level, String(msg).slice(0, 5000)]);
  } catch (e) {
    console.error(msg);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Jalankan manual dari editor untuk mengecek isi Sheet sebelum deploy. */
function testBootstrap() {
  const r = bootstrap_();
  console.log('Jemaat aktif:', r.members.length,
    '| Sampel wajah:', r.faces.length,
    '| Kegiatan hari ini:', r.event ? r.event.id_kegiatan + ' ' + r.event.nama : '(tidak ada)');
}

/** Jalankan sekali dari editor untuk membuat dua token acak di Script Properties. */
function generateTokens() {
  const props = PROPS.getProperties();
  const gen = () => Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
  if (!props.API_TOKEN) PROPS.setProperty('API_TOKEN', gen());
  if (!props.ENROLL_TOKEN) PROPS.setProperty('ENROLL_TOKEN', gen());
  console.log('Token sudah ada di Project Settings → Script Properties. Salin dari sana, jangan dari log ini.');
}
