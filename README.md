# Presensi Wajah

Kiosk presensi kegiatan gereja di tablet: wajah dikenali di browser, jemaat menekan **"Ya, saya"**, dan kehadiran tercatat di Google Sheet. Jika wajah tidak dikenali, jemaat mencari nama atau tanggal lahir (DDMMYY), seperti di DLP.

- **Tampilan** (`docs/`): HTML + JavaScript statis, di-host di GitHub Pages (HTTPS, wajib untuk kamera).
- **Pengenalan wajah**: [Human](https://github.com/vladmandic/human) (MIT), berjalan di tablet. **Tidak ada foto yang dikirim ke server**; yang disimpan hanya embedding (deret angka).
- **API** (`apps-script/`): Google Apps Script web app yang membaca/menulis Google Sheet.
- **Database**: Google Sheet `Presensi Wajah` (tab Jemaat, Wajah, Kegiatan, Presensi, Log).

> Repo ini **public** (syarat GitHub Pages gratis). Jangan pernah commit token, URL API, data jemaat, file `.xlsx` atau `.csv`.

## Struktur

```text
apps-script/          kode API (Code.js, appsscript.json)
docs/                 tampilan yang dibaca GitHub Pages
  index.html          kiosk presensi (tablet)
  setup.html          pengaturan tablet: URL API, token, nama perangkat, threshold
  daftar.html         pendaftaran wajah (petugas, butuh ENROLL_TOKEN)
  js/                 api, face, queue, search, kiosk, setup, daftar, pwa
  sw.js               service worker (offline)
```

## 1. Google Sheet

Pakai file `Presensi Wajah` (dari template Excel Tahap 1, sudah di-*Save as Google Sheets*). Nama tab dan judul kolom tidak boleh diubah.

## 2. Pasang API (Apps Script)

```bash
npm install -g @google/clasp
clasp login                      # login dengan akun pemilik Google Sheet
```

Aktifkan dulu "Google Apps Script API" di <https://script.google.com/home/usersettings>.

1. Buka Google Sheet → **Extensions → Apps Script**. Salin **Script ID** dari Project Settings.
2. Di folder `apps-script/`, salin `.clasp.json.example` menjadi `.clasp.json` dan isi `scriptId`.
   (Jangan pakai `clasp clone` — itu menimpa `Code.js` di repo dengan file kosong dari server.)
3. Kirim kode ke Apps Script:
   ```bash
   cd apps-script
   clasp push -f
   ```
4. Di editor Apps Script, jalankan fungsi **`generateTokens`** sekali (izinkan akses saat diminta).
   Token muncul di Project Settings → Script Properties: `API_TOKEN` dan `ENROLL_TOKEN`.
5. Jalankan **`testBootstrap`** untuk mengecek jumlah jemaat aktif dan kegiatan hari ini (lihat Execution log).
6. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   Salin URL yang berakhiran `/exec` — ini **URL API**.
7. Setiap ada perubahan kode: `clasp push -f`, lalu Deploy → Manage deployments → Edit → Version: **New version** (URL tetap sama).

> **Akun Google Workspace**: jika opsi akses hanya "Anyone within &lt;domain&gt;", tablet tidak akan bisa memanggil API. Izinkan berbagi ke luar domain di Admin console (Apps → Google Workspace → Drive and Docs → Sharing settings).

Uji API dari terminal (`-L` wajib karena Apps Script mengalihkan respons):

```bash
curl -L -X POST "$API_URL" -H "Content-Type: text/plain" \
  -d '{"action":"bootstrap","token":"ISI_API_TOKEN"}'
```

## 3. Aktifkan GitHub Pages

Settings → Pages → Source **Deploy from a branch** → branch `main`, folder **`/docs`** → Save.
Situs tersedia di `https://iwanhe.github.io/presensi-wajah/` dalam 1–2 menit setelah push.

Semua path di HTML relatif (`js/kiosk.js`, bukan `/js/kiosk.js`) karena situs berada di subfolder.

## 4. Atur tablet

1. Buka `https://iwanhe.github.io/presensi-wajah/setup.html` di Chrome tablet.
2. Isi URL API, `API_TOKEN`, nama perangkat (mis. `TAB-01`), threshold `0.55`. Tekan **Tes koneksi**.
3. Perangkat petugas pendaftaran juga mengisi `ENROLL_TOKEN`. **Tablet kiosk tidak perlu** token ini.
4. Buka kiosk (`index.html`), izinkan kamera, lalu menu Chrome → **Add to Home screen**.
5. Aktifkan App pinning dan "Stay awake" (lihat panduan Tahap 8).

## Menjalankan di laptop

```bash
npx serve docs      # buka http://localhost:3000/setup.html
```

Kamera boleh dipakai di `localhost` tanpa HTTPS.

## Alur kiosk

1. Wajah dikenali → layar konfirmasi nama → **Ya, saya** → tercatat (metode `wajah`).
2. **Bukan**, atau wajah tidak dikenali 3 detik → **Cari Nama** (nama atau DDMMYY, ada keypad angka besar).
3. **Scan QR** (opsional): isi QR = `id_jemaat`.
4. **Saya tidak terdaftar** → presensi tamu (`TAMU-…`), ditindaklanjuti sekretariat.

Presensi disimpan di tablet dulu (IndexedDB), lalu dikirim per batch tiap 15 detik. WiFi putus tidak menghentikan antrean; jumlah yang belum terkirim tampil di pojok kanan atas. Duplikat (orang yang sama, kegiatan yang sama) diabaikan di server.

## Menyetel threshold

`setup.html` menampilkan statistik tablet: jumlah konfirmasi wajah dan jumlah "Bukan".

- Banyak "Bukan" (salah kenali) → **naikkan** threshold 0,05.
- Banyak jemaat terdaftar jatuh ke Cari Nama → **turunkan** 0,05.

Ubah satu kali per minggu dan catat hasilnya. Kolom `similarity` di tab Presensi membantu analisis.

## Privasi (UU PDP)

- Data wajah hanya didaftarkan untuk jemaat dengan `consent_wajah = Y`; server menolak selain itu.
- Embedding wajah jemaat yang persetujuannya dicabut tidak dikirim ke kiosk. Hapus juga datanya lewat tombol **Hapus semua data wajah** di `daftar.html`.
- Google Sheet hanya dibagikan ke PIC sekretariat dan developer.

## Lisensi

MIT. Library pihak ketiga dimuat dari jsDelivr dengan versi terkunci: `@vladmandic/human@3.3.6` (MIT), `idb-keyval@6.3.0` (Apache-2.0), `html5-qrcode@2.3.8` (Apache-2.0).
