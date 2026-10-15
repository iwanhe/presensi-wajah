// Pencarian jemaat untuk jalur cadangan (wajah tidak dikenali / tidak terdaftar).
// Input 6 angka dianggap tanggal lahir DDMMYY; selain itu dicari di nama.
export function searchMembers(members, q, limit = 8) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 3) return [];
  const isDate = /^\d{6}$/.test(s);
  const list = [];
  for (const m of members.values()) {
    const hit = isDate ? m.tglLahir === s : String(m.nama).toLowerCase().includes(s);
    if (hit) list.push(m);
    if (list.length >= limit) break;
  }
  return list;
}

/** Teks pembeda untuk nama yang sama. Tanggal lahir sengaja tidak ditampilkan. */
export function memberInfo(m) {
  return [m.kategori, m.wilayah].filter(Boolean).join(' · ');
}
