/**
 * Registry map kantor: `Floor.mapKey` (kontrak @vc/shared) → berkas Tiled JSON.
 *
 * Satu sumber kebenaran agar OfficeScene tak meng-hardcode satu berkas map (CR-103).
 * Phase 1 hanya punya SATU aset map nyata (`office.json`); penambahan map lain dan
 * pergantian map antar-lantai saat runtime menyusul di Phase 5 (multi-floor/multi-map).
 */

/** Kunci map default (samakan dengan default `mapKey` di server `createFloor`). */
export const DEFAULT_MAP_KEY = "office-default";

/** mapKey → path aset Tiled. Tambah entri di sini saat aset map baru tersedia (Phase 5). */
const MAP_ASSETS: Record<string, string> = {
  "office-default": "assets/maps/office.json",
};

/** Apakah mapKey punya aset terdaftar. */
export function isKnownMapKey(mapKey: string | undefined): boolean {
  return !!mapKey && mapKey in MAP_ASSETS;
}

/** Path Tiled untuk mapKey; fallback ke default bila tak dikenal (dengan peringatan). */
export function mapPathFor(mapKey: string | undefined): string {
  if (mapKey && mapKey in MAP_ASSETS) return MAP_ASSETS[mapKey]!;
  if (mapKey) {
    console.warn(
      `[maps] mapKey '${mapKey}' belum punya aset terdaftar — pakai '${DEFAULT_MAP_KEY}'. ` +
        "Map tambahan & pergantian antar-lantai = Phase 5.",
    );
  }
  return MAP_ASSETS[DEFAULT_MAP_KEY]!;
}
