// Pengenalan wajah di browser memakai library open source Human (MIT).
// Tidak ada foto yang dikirim ke server; yang disimpan hanya embedding (deret angka).
import { Human } from 'https://cdn.jsdelivr.net/npm/@vladmandic/human@3.3.6/dist/human.esm.js';

export const HUMAN_VERSION = '3.3.6';
const MODEL_URL = `https://cdn.jsdelivr.net/npm/@vladmandic/human@${HUMAN_VERSION}/models/`;

export const human = new Human({
  modelBasePath: MODEL_URL,
  backend: 'webgl',
  debug: false,
  // Cache dimatikan: di kiosk orang berganti cepat, hasil frame sebelumnya tidak boleh dipakai ulang
  cacheSensitivity: 0,
  face: {
    enabled: true,
    detector: { maxDetected: 1, rotation: false, skipFrames: 0, skipTime: 0 },
    mesh: { enabled: true },
    description: { enabled: true, skipFrames: 0, skipTime: 0 }, // menghasilkan embedding
    antispoof: { enabled: true, skipFrames: 0, skipTime: 0 },   // deteksi foto/layar palsu
    liveness: { enabled: true, skipFrames: 0, skipTime: 0 },
    iris: { enabled: false },
    emotion: { enabled: false },
  },
  body: { enabled: false },
  hand: { enabled: false },
  object: { enabled: false },
  gesture: { enabled: false },
  segmentation: { enabled: false },
});

export async function initFace(onStatus = () => {}) {
  onStatus('Memuat model pengenalan wajah…');
  await human.load();
  onStatus('Menyiapkan…');
  // panaskan kedua mode agar deteksi pertama di depan jemaat tidak tersendat
  await human.warmup(FAST);
  await human.warmup(FULL);
}

let stream = null;

export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Kamera tidak tersedia. Pastikan halaman dibuka lewat HTTPS.');
  }
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();
}

export function stopCamera(video) {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
}

// Dua mode deteksi. Human menggabungkan config ke instance secara permanen,
// jadi setiap mode menuliskan semua saklar secara eksplisit.
const FAST = {
  face: {
    mesh: { enabled: false },
    description: { enabled: false },
    antispoof: { enabled: false },
    liveness: { enabled: false },
  },
};
const FULL = {
  face: {
    mesh: { enabled: true },
    description: { enabled: true },
    antispoof: { enabled: true },
    liveness: { enabled: true },
  },
};

export let lastDetectMs = 0;

export function backendName() {
  try { return human.tf.getBackend(); } catch { return '?'; }
}

/**
 * Baca satu wajah dari video. Mengembalikan null jika tidak ada wajah.
 * full=false: hanya deteksi kotak wajah (ringan, untuk menunggu orang mendekat).
 * full=true : ditambah embedding, anti-spoof, liveness, dan arah wajah (berat).
 * width: lebar kotak wajah relatif terhadap lebar gambar (0..1), dipakai untuk mengukur jarak.
 */
export async function readFace(video, { full = true } = {}) {
  if (!video || video.readyState < 2) return null;
  const t0 = performance.now();
  const res = await human.detect(video, full ? FULL : FAST);
  lastDetectMs = performance.now() - t0;
  const f = res.face && res.face[0];
  if (!f) return null;
  return {
    full,
    embedding: f.embedding && f.embedding.length ? f.embedding : null,
    score: f.score ?? 0,
    width: f.boxRaw ? f.boxRaw[2] : 0,
    real: f.real ?? 0,
    live: f.live ?? 0,
    yaw: f.rotation?.angle?.yaw ?? 0,
  };
}

/** Cari wajah paling mirip. db = array embedding, owners = id jemaat untuk tiap embedding. */
export function bestMatch(embedding, db, owners) {
  if (!embedding || !db.length) return { id: null, similarity: 0 };
  const r = human.match.find(embedding, db);
  if (r.index < 0) return { id: null, similarity: 0 };
  return { id: owners[r.index], similarity: r.similarity };
}

export function similarity(a, b) {
  return human.match.similarity(a, b);
}
