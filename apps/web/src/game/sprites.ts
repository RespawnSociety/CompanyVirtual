/**
 * Pemetaan warna placeholder untuk tile & sprite karakter.
 * Phase 1 belum pakai aset PNG; semua tekstur dibuat runtime (Phaser Graphics).
 */

export const TILE = {
  WIDTH: 32,
  HEIGHT: 32,
  /** gid Tiled → indeks tile pada texture generated (firstgid = 1). */
  FLOOR_GID: 1,
  WALL_GID: 2,
} as const;

/** Warna 4 tile pada tileset generated (urut indeks 0..3 = gid 1..4). */
export const TILE_COLORS = [
  0x2a3350, // 0: floor
  0x47526f, // 1: wall
  0x6b4a2a, // 2: desk
  0x244b42, // 3: carpet/accent
];

/** Warna karakter per spriteKey/role (placeholder). */
const SPRITE_COLORS: Record<string, number> = {
  manager: 0x4f7cff,
  market_checker: 0x2bd9a8,
  script_maker: 0xffcc66,
  reviewer: 0xc77dff,
  social_media: 0xff5d6c,
  default: 0x9aa6c2,
};

export function colorForSprite(spriteKey: string): number {
  return SPRITE_COLORS[spriteKey] ?? SPRITE_COLORS["default"]!;
}
