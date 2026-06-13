/**
 * Registry map kantor: `Floor.mapKey` (kontrak @vc/shared) → berkas Tiled JSON.
 *
 * Satu sumber kebenaran agar OfficeScene tak meng-hardcode satu berkas map (CR-103).
 * Phase 5 (multi-floor): ada >1 aset map; OfficeScene memuat & menukar map saat lantai
 * berganti (lihat `OfficeScene.ensureMapForFloor`).
 */

/** Kunci map default (samakan dengan default `mapKey` di server `createFloor`). */
export const DEFAULT_MAP_KEY = "office-default";

/** mapKey → path aset Tiled. Tambah entri di sini saat aset map baru tersedia. */
const MAP_ASSETS: Record<string, string> = {
  "office-default": "assets/maps/office.json",
  // Phase 5.2: lantai dengan dua ruang (sekat tengah + pintu) agar tiap lantai terbedakan.
  "office-open": "assets/maps/office2.json",
};

/** Pilihan map untuk UI (Company setup): mapKey + label ramah. */
export const MAP_CHOICES: readonly { key: string; label: string }[] = [
  { key: "office-default", label: "Kantor terbuka (default)" },
  { key: "office-open", label: "Kantor dua ruang (bersekat)" },
];

/** Apakah mapKey punya aset terdaftar. */
export function isKnownMapKey(mapKey: string | undefined): boolean {
  return !!mapKey && mapKey in MAP_ASSETS;
}

/** Path Tiled untuk mapKey; fallback ke default bila tak dikenal (dengan peringatan). */
export function mapPathFor(mapKey: string | undefined): string {
  if (mapKey && mapKey in MAP_ASSETS) return MAP_ASSETS[mapKey]!;
  if (mapKey) {
    console.warn(`[maps] mapKey '${mapKey}' belum punya aset terdaftar — pakai '${DEFAULT_MAP_KEY}'.`);
  }
  return MAP_ASSETS[DEFAULT_MAP_KEY]!;
}
