// Daftarkan service worker agar kiosk tetap terbuka saat tablet dinyalakan tanpa internet.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW gagal:', e));
  });
}
