# Drop karakter pixel-art di sini (gaya Stardew "versi kantoran")

Taruh **spritesheet karakter** (PNG) di folder ini, lalu beri tahu saya nama file + ukuran
frame-nya — saya akan wiring jadi karakter beranimasi (idle + jalan 4 arah) menggantikan
"pawn" kode sekarang. Tak perlu ngoding; cukup drop gambar + sebut formatnya.

## Rekomendasi pack (paling mirip Stardew kantoran)
- **LimeZu — Modern Office / Modern Interiors** (itch.io): pixel-art modern-office gaya Stardew,
  lengkap dengan karakter + furnitur. Ada versi **gratis (terbatas)** & **berbayar (lengkap)**.
  https://limezu.itch.io/modernoffice · https://limezu.itch.io/moderninteriors
- Alternatif gratis/CC0 (gaya lebih generik): Kenney (kenney.nl, CC0), atau
  "15 Top-Down Character Sprites" (CC0) di itch.io.

> Lisensi: pakai aset yang kamu punya hak pakainya (CC0 / beli / free-with-credit). JANGAN
> taruh art bajakan. Kalau CC0/atribusi, sebutkan sumbernya — saya catat di kredit.

## Format yang saya butuh (sebutkan saat drop file)
- Nama file per role/spriteKey (mis. `manager.png`, `social_media.png`) **atau** satu sheet berisi
  banyak karakter.
- **Ukuran 1 frame** (mis. 16×32 atau 32×32 px).
- **Layout**: berapa kolom per animasi + urutan arah (mis. baris = down/left/right/up; tiap baris
  N frame jalan). Kalau ada idle, sebutkan.
- Sebut juga apakah perlu di-scale (sprite kecil 16px sering di-zoom 2–3×).

Begitu file masuk + format disebut, saya pasang loader + animasinya (fallback ke pawn kalau kosong).
