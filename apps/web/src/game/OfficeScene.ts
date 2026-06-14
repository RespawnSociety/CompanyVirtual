/**
 * OfficeScene — kantor 2D **isometrik** (Phase 6; gaya referensi ruang kantor iso).
 *
 * - Logika tetap berbasis grid kotak (tile x,y) + pathfinding easystarjs (top-down).
 * - RENDER diproyeksikan isometrik (diamond 2:1): lantai diamond, dua dinding belakang
 *   berwarna + jendela, furnitur iso (meja+monitor, kursi), karakter "pawn". Depth-sort
 *   per (x+y) agar objek depan menutup objek belakang.
 * - Klik dipetakan balik ke tile (inverse iso) → pilih karakter / jalan ke petak.
 * - HUD jam + karakter terpilih. Multi-floor (Phase 5.2): swap aset map saat lantai berganti.
 *
 * Map Tiled tetap dimuat HANYA untuk grid (walkability); layer-nya disembunyikan, lantai &
 * dinding digambar ulang secara isometrik dari grid.
 */

import Phaser from "phaser";
import EasyStar from "easystarjs";
import type { AgentProfile, AgentStatus, Floor, WorldSnapshot } from "@vc/shared";
import { TILE, TILE_COLORS, colorForSprite } from "./sprites.js";
import { DEFAULT_MAP_KEY, isKnownMapKey, mapPathFor } from "./maps.js";

const TILESET_TEX = "tiles-gen"; // tileset untuk layer grid (disembunyikan)
const CHAR_TEX = "char-iso"; // pawn karakter
const DESK_TEX = "desk-iso"; // meja + monitor (iso)
const CHAIR_TEX = "chair-iso"; // kursi (iso)
const FLOOR_TEX = "floor-iso"; // ubin lantai diamond
// Dekorasi ruang (Phase 6) agar kantor tak sepi.
const PLANT_TEX = "plant-iso";
const VENDING_TEX = "vending-iso";
const COOLER_TEX = "cooler-iso";
const ELEVATOR_TEX = "elevator-iso";

// Dimensi ubin isometrik (diamond 2:1).
const ISO_W = 64;
const ISO_H = 32;
const WALL_H = 64; // tinggi dinding belakang
// Sub-lapisan depth pada satu petak. Karakter PALING DEPAN agar tak tertutup meja.
const D_FLOOR = -100000;
const D_WALL = -90000;
const SUB_CHAIR = 1;
const SUB_DESK = 3;
const SUB_CHAR = 6;
// Geser karakter sedikit ke depan (bawah layar) → berdiri di depan meja & jelas terlihat.
const CHAR_FRONT_OFFSET = 16;

// Karakter pixel-art LimeZu Modern Interiors (free) — frame 16×32, 4 arah × 6 frame.
type Dir = "down" | "up" | "left" | "right";
const LZ_BASE = "assets/tilesets/Modern tiles_Free/Characters_free";
const LZ_CHARS = ["Adam", "Alex", "Amelia", "Bob"] as const;
const LZ_FRAME = { frameWidth: 16, frameHeight: 32 } as const;
const CHAR_SCALE = 2.2;
// Frame awal tiap arah pada strip 24-frame (run/idle_anim). Sesuaikan bila arah hadap salah.
const DIR_FRAMES: Record<Dir, number> = { down: 0, up: 6, left: 12, right: 18 };

interface CharObj {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Ellipse;
  statusDot: Phaser.GameObjects.Arc;
  statusTween?: Phaser.Tweens.Tween;
  status: AgentStatus;
  /** Petak posisi karakter SAAT INI (berubah saat berjalan). */
  tile: { x: number; y: number };
  /** Furnitur statis di petak meja (tetap walau karakter berjalan). */
  desk: Phaser.GameObjects.Image;
  chair: Phaser.GameObjects.Image;
  deskTile: { x: number; y: number };
  active?: Phaser.Tweens.TweenChain;
  /** Sedang berkeliling ambient (bukan diarahkan user/directive). */
  roaming?: boolean;
  /** Nama karakter LimeZu (Adam/…) bila sprite asli dipakai; null = fallback pawn kode. */
  charName?: string;
  /** Arah hadap terakhir (untuk anim idle). */
  faceDir: Dir;
  /** Skala dasar sprite (LimeZu di-scale; pawn = 1) — dipakai animasi denyut working. */
  baseScale: number;
}

const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x55607a,
  working: 0x4aa3ff,
  talking: 0x4ade80,
  blocked: 0xf87171,
};

export class OfficeScene extends Phaser.Scene {
  private ready = false;
  private pending: { snapshot: WorldSnapshot; floorId?: string } | null = null;

  private easystar = new EasyStar.js();
  private grid: number[][] = [];
  private gridW = 0;
  private gridH = 0;

  // Origin proyeksi iso (di-set saat board dirender agar board ter-center horizontal).
  private originX = 0;
  private originY = 90;

  private chars = new Map<string, CharObj>();
  private selectedId: string | null = null;

  // Objek lantai + dinding + dekorasi (digambar ulang tiap ganti lantai).
  private floorTiles: Phaser.GameObjects.Image[] = [];
  private props: Phaser.GameObjects.Image[] = [];
  private roomGfx: Phaser.GameObjects.Graphics | null = null;
  // Lift (bisa diklik untuk pindah lantai) + daftar lantai/aktif untuk siklus.
  private elevator: Phaser.GameObjects.Image | null = null;
  private floorsList: Floor[] = [];
  private currentFloorId: string | null = null;

  private clockText!: Phaser.GameObjects.Text;
  private minutes = 9 * 60;

  private renderedMapKey = DEFAULT_MAP_KEY;
  private desiredMapKey = DEFAULT_MAP_KEY;
  private loadingMapKey: string | null = null;
  private gridLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private readonly warnedMapKeys = new Set<string>();

  constructor() {
    super("office");
  }

  preload(): void {
    this.load.tilemapTiledJSON(DEFAULT_MAP_KEY, mapPathFor(DEFAULT_MAP_KEY));
    // Sprite karakter LimeZu (walk = "run", idle = "idle_anim"). Bila gagal muat → fallback pawn.
    for (const name of LZ_CHARS) {
      this.load.spritesheet(`lz-${name}-walk`, `${LZ_BASE}/${name}_run_16x16.png`, LZ_FRAME);
      this.load.spritesheet(`lz-${name}-idle`, `${LZ_BASE}/${name}_idle_anim_16x16.png`, LZ_FRAME);
    }
  }

  create(): void {
    this.makeTextures();
    this.makeCharAnims();
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableSync();
    this.buildMap(DEFAULT_MAP_KEY);
    this.renderedMapKey = DEFAULT_MAP_KEY;

    this.clockText = this.add
      .text(8, 8, "", {
        fontFamily: "Consolas, monospace",
        fontSize: "13px",
        color: "#e6ebf5",
        backgroundColor: "#0f1420cc",
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(1_000_000);

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.handleClick(p.worldX, p.worldY);
    });

    // Ambient: agent idle berkeliling acak & sesekali "ngobrol" (gelembung) agar kantor hidup.
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.ambientTick() });

    this.ready = true;
    if (this.pending) {
      this.applyWorld(this.pending.snapshot, this.pending.floorId);
      this.pending = null;
    }
  }

  override update(_time: number, delta: number): void {
    this.easystar.calculate();
    this.minutes = (this.minutes + (delta / 1000) * 2) % (24 * 60);
    const hh = String(Math.floor(this.minutes / 60)).padStart(2, "0");
    const mm = String(Math.floor(this.minutes % 60)).padStart(2, "0");
    const sel = this.selectedId ? this.chars.get(this.selectedId) : undefined;
    const who = sel ? ` · dipilih: ${sel.label.text}` : "";
    this.clockText.setText(`🕒 ${hh}:${mm}${who}`);
  }

  applyWorld(snapshot: WorldSnapshot, floorId?: string): void {
    if (!this.ready) {
      this.pending = { snapshot, ...(floorId ? { floorId } : {}) };
      return;
    }
    const targetFloor = floorId ?? snapshot.floors[0]?.id;
    this.floorsList = snapshot.floors;
    this.currentFloorId = targetFloor ?? null;
    this.ensureMapForFloor(snapshot.floors.find((f) => f.id === targetFloor)?.mapKey);
    const deptOnFloor = new Set(
      snapshot.departments.filter((d) => d.floorId === targetFloor).map((d) => d.id),
    );
    const agents = snapshot.agents.filter((a) => deptOnFloor.has(a.departmentId));
    const seen = new Set<string>();

    for (const agent of agents) {
      seen.add(agent.id);
      const existing = this.chars.get(agent.id);
      if (existing) {
        existing.label.setText(agent.name);
        // Pawn fallback di-tint per role; sprite LimeZu JANGAN di-tint (merusak warna art).
        if (!existing.charName) existing.sprite.setTint(colorForSprite(agent.spriteKey));
        // Pindahkan meja+karakter hanya bila deskPos (rumah) berubah, bukan saat berjalan.
        const t = this.clampTile(agent.deskPos.x, agent.deskPos.y);
        if (t.x !== existing.deskTile.x || t.y !== existing.deskTile.y) {
          existing.active?.stop();
          existing.tile = t;
          existing.deskTile = { x: t.x, y: t.y };
          this.placeStation(existing);
        }
      } else {
        this.chars.set(agent.id, this.spawnChar(agent));
      }
    }
    for (const [id, obj] of this.chars) {
      if (!seen.has(id)) {
        obj.active?.stop();
        obj.statusTween?.stop();
        obj.container.destroy();
        obj.desk.destroy();
        obj.chair.destroy();
        this.chars.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
    if (!this.selectedId && this.chars.size > 0) {
      this.select(this.chars.keys().next().value as string);
    }
  }

  // ---------------- proyeksi isometrik ----------------

  private tileToIso(tx: number, ty: number): { wx: number; wy: number } {
    return {
      wx: this.originX + (tx - ty) * (ISO_W / 2),
      wy: this.originY + (tx + ty) * (ISO_H / 2),
    };
  }

  private isoToTile(wx: number, wy: number): { x: number; y: number } {
    const dx = wx - this.originX;
    const dy = wy - this.originY;
    const fx = (dy / (ISO_H / 2) + dx / (ISO_W / 2)) / 2;
    const fy = (dy / (ISO_H / 2) - dx / (ISO_W / 2)) / 2;
    return { x: Math.floor(fx + 0.5), y: Math.floor(fy + 0.5) };
  }

  /** Depth dasar sebuah petak (objek lebih depan = (x+y) lebih besar → di atas). */
  private depthFor(tx: number, ty: number): number {
    return (tx + ty) * 10;
  }

  // ---------------- map & ruang ----------------

  private ensureMapForFloor(mapKey: string | undefined): void {
    const desired = mapKey ?? DEFAULT_MAP_KEY;
    const assetKey = isKnownMapKey(desired) ? desired : DEFAULT_MAP_KEY;
    if (assetKey !== desired && !this.warnedMapKeys.has(desired)) {
      this.warnedMapKeys.add(desired);
      console.warn(`[OfficeScene] mapKey '${desired}' tak terdaftar — render '${DEFAULT_MAP_KEY}'.`);
    }
    this.desiredMapKey = assetKey;
    if (assetKey === this.renderedMapKey || assetKey === this.loadingMapKey) return;

    if (this.cache.tilemap.exists(assetKey)) {
      this.buildMap(assetKey);
      this.renderedMapKey = assetKey;
      return;
    }
    this.loadingMapKey = assetKey;
    this.load.tilemapTiledJSON(assetKey, mapPathFor(assetKey));
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      this.loadingMapKey = null;
      if (!this.cache.tilemap.exists(assetKey)) return;
      if (assetKey !== this.desiredMapKey) return;
      this.buildMap(assetKey);
      this.renderedMapKey = assetKey;
    });
    this.load.start();
  }

  /** Bangun grid (dari Tiled, layer disembunyikan) + render ulang lantai & dinding iso. */
  private buildMap(cacheKey: string): void {
    this.gridLayer?.destroy();
    this.tilemap?.destroy();
    this.gridLayer = null;
    this.tilemap = null;

    const map = this.make.tilemap({ key: cacheKey });
    const tileset = map.addTilesetImage("office", TILESET_TEX);
    if (!tileset) return;
    const layer = map.createLayer("ground", tileset, 0, 0);
    if (!layer) return;
    layer.setVisible(false); // hanya dipakai untuk data grid; render iso digambar manual.
    this.tilemap = map;
    this.gridLayer = layer;
    this.gridW = map.width;
    this.gridH = map.height;
    this.buildGrid(layer);
    this.easystar.setGrid(this.grid);

    // Center board secara horizontal: koreksi asimetri (gridW vs gridH).
    this.originX = this.scale.width / 2 - (this.gridW - this.gridH) * (ISO_W / 4);
    this.originY = WALL_H + 36;
    this.renderRoom();
    // Setelah board dibangun ulang, posisikan ulang station tiap karakter yg ada.
    for (const obj of this.chars.values()) this.placeStation(obj);
  }

  private buildGrid(layer: Phaser.Tilemaps.TilemapLayer): void {
    this.grid = [];
    for (let y = 0; y < this.gridH; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.gridW; x++) {
        const tile = layer.getTileAt(x, y);
        row.push(tile && tile.index === TILE.WALL_GID ? 1 : 0);
      }
      this.grid.push(row);
    }
  }

  /** Gambar lantai diamond untuk tiap petak + dua dinding belakang berwarna + jendela. */
  private renderRoom(): void {
    for (const t of this.floorTiles) t.destroy();
    this.floorTiles = [];
    for (const p of this.props) p.destroy();
    this.props = [];
    this.elevator = null;
    this.roomGfx?.destroy();

    // Lantai (semua petak; karakter dibatasi ke petak dalam oleh clampTile + grid).
    for (let y = 0; y < this.gridH; y++) {
      for (let x = 0; x < this.gridW; x++) {
        const { wx, wy } = this.tileToIso(x, y);
        const img = this.add.image(wx, wy, FLOOR_TEX).setDepth(D_FLOOR);
        this.floorTiles.push(img);
      }
    }

    // Dua dinding belakang (sepanjang tepi ty=0 dan tx=0) sebagai poligon iso.
    const g = this.add.graphics().setDepth(D_WALL);
    const A = this.tileToIso(0, 0); // sudut belakang
    A.wy -= ISO_H / 2; // ke vertex atas petak (0,0)
    const right = this.tileToIso(this.gridW - 1, 0);
    right.wx += ISO_W / 2; // vertex kanan petak terjauh
    const left = this.tileToIso(0, this.gridH - 1);
    left.wx -= ISO_W / 2; // vertex kiri petak terjauh

    // Dinding kanan-belakang (oranye terang) — A → right.
    g.fillStyle(0xb6552f, 1);
    g.fillPoints(
      [
        { x: A.wx, y: A.wy },
        { x: right.wx, y: right.wy },
        { x: right.wx, y: right.wy - WALL_H },
        { x: A.wx, y: A.wy - WALL_H },
      ],
      true,
    );
    // Dinding kiri-belakang (oranye gelap) — A → left.
    g.fillStyle(0x97431f, 1);
    g.fillPoints(
      [
        { x: A.wx, y: A.wy },
        { x: left.wx, y: left.wy },
        { x: left.wx, y: left.wy - WALL_H },
        { x: A.wx, y: A.wy - WALL_H },
      ],
      true,
    );

    // Jendela pada dinding kanan + bingkai pada dinding kiri (dekorasi seperti referensi).
    this.drawWallDecor(g, A, right, [0.45, 0.72], 0xcfe0f2); // jendela (biru terang)
    this.drawWallDecor(g, A, left, [0.4, 0.66], 0xe0c45a); // bingkai (kuning)

    this.roomGfx = g;
    this.placeProps();
  }

  /** Pasang dekorasi (lift, vending, dispenser, tanaman) di petak tepi agar ruang tak sepi. */
  private placeProps(): void {
    const W = this.gridW;
    const H = this.gridH;
    const add = (tex: string, tx: number, ty: number): Phaser.GameObjects.Image | null => {
      if (tx < 0 || ty < 0 || tx >= W || ty >= H) return null;
      const { wx, wy } = this.tileToIso(tx, ty);
      const img = this.add.image(wx, wy, tex).setOrigin(0.5, 0.9).setDepth(this.depthFor(tx, ty) + 2);
      this.props.push(img);
      return img;
    };
    // Lift di sudut belakang (bisa diklik untuk pindah lantai).
    this.elevator = add(ELEVATOR_TEX, 1, 1);
    // Mesin minuman + dispenser dekat dinding belakang-kanan.
    add(VENDING_TEX, W - 2, 1);
    add(COOLER_TEX, W - 2, 3);
    // Tanaman di sudut-sudut depan.
    add(PLANT_TEX, 1, H - 2);
    add(PLANT_TEX, W - 2, H - 2);
    add(PLANT_TEX, 3, 1);
  }

  /** Gambar panel (jendela/bingkai) pada dinding A→end di posisi `fracs` sepanjang dinding. */
  private drawWallDecor(
    g: Phaser.GameObjects.Graphics,
    A: { wx: number; wy: number },
    end: { wx: number; wy: number },
    fracs: number[],
    color: number,
  ): void {
    const halfW = 0.06; // setengah lebar panel (fraksi panjang dinding)
    const top = WALL_H * 0.62;
    const bot = WALL_H * 0.3;
    for (const f of fracs) {
      const lerp = (t: number, k: "wx" | "wy"): number => A[k] + (end[k] - A[k]) * t;
      const x0 = lerp(f - halfW, "wx");
      const y0 = lerp(f - halfW, "wy");
      const x1 = lerp(f + halfW, "wx");
      const y1 = lerp(f + halfW, "wy");
      g.fillStyle(0x14213a, 1); // bingkai gelap
      g.fillPoints(
        [
          { x: x0, y: y0 - bot },
          { x: x1, y: y1 - bot },
          { x: x1, y: y1 - top },
          { x: x0, y: y0 - top },
        ],
        true,
      );
      const inset = 0.012;
      const ix0 = lerp(f - halfW + inset, "wx");
      const iy0 = lerp(f - halfW + inset, "wy");
      const ix1 = lerp(f + halfW - inset, "wx");
      const iy1 = lerp(f + halfW - inset, "wy");
      g.fillStyle(color, 1);
      g.fillPoints(
        [
          { x: ix0, y: iy0 - bot - 3 },
          { x: ix1, y: iy1 - bot - 3 },
          { x: ix1, y: iy1 - top + 3 },
          { x: ix0, y: iy0 - top + 3 },
        ],
        true,
      );
    }
  }

  // ---------------- tekstur (placeholder generated) ----------------

  private makeTextures(): void {
    // Tileset untuk layer grid (disembunyikan) — cukup ada agar createLayer valid.
    if (!this.textures.exists(TILESET_TEX)) {
      const g = this.add.graphics();
      for (let i = 0; i < TILE_COLORS.length; i++) {
        g.fillStyle(TILE_COLORS[i]!, 1);
        g.fillRect(i * TILE.WIDTH, 0, TILE.WIDTH, TILE.HEIGHT);
      }
      g.generateTexture(TILESET_TEX, TILE.WIDTH * TILE_COLORS.length, TILE.HEIGHT);
      g.destroy();
    }

    // Ubin lantai diamond (64×32).
    if (!this.textures.exists(FLOOR_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x6f7796, 1);
      g.fillPoints(
        [
          { x: 32, y: 0 },
          { x: 64, y: 16 },
          { x: 32, y: 32 },
          { x: 0, y: 16 },
        ],
        true,
      );
      g.lineStyle(1, 0x4a5274, 0.7);
      g.strokePoints(
        [
          { x: 32, y: 0 },
          { x: 64, y: 16 },
          { x: 32, y: 32 },
          { x: 0, y: 16 },
        ],
        true,
        true,
      );
      g.generateTexture(FLOOR_TEX, 64, 32);
      g.destroy();
    }

    // Karakter "pawn" (kepala + badan), putih agar bisa di-tint per role. 26×38.
    if (!this.textures.exists(CHAR_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.25);
      g.fillEllipse(13, 35, 20, 8); // bayangan
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(4, 13, 18, 21, 6); // badan
      g.fillCircle(13, 9, 7); // kepala
      g.generateTexture(CHAR_TEX, 26, 40);
      g.destroy();
    }

    // Meja iso + monitor. 72×64.
    if (!this.textures.exists(DESK_TEX)) {
      const g = this.add.graphics();
      const cx = 36;
      const topY = 26;
      // permukaan meja (diamond)
      g.fillStyle(0x8a6038, 1);
      g.fillPoints(pts([cx, topY], [cx + 30, topY + 14], [cx, topY + 28], [cx - 30, topY + 14]), true);
      // sisi kiri & kanan (lebih gelap) untuk kesan tebal
      g.fillStyle(0x5e4225, 1);
      g.fillPoints(pts([cx - 30, topY + 14], [cx, topY + 28], [cx, topY + 44], [cx - 30, topY + 30]), true);
      g.fillStyle(0x6f4d2b, 1);
      g.fillPoints(pts([cx, topY + 28], [cx + 30, topY + 14], [cx + 30, topY + 30], [cx, topY + 44]), true);
      // monitor di atas meja
      g.fillStyle(0x12182a, 1);
      g.fillRoundedRect(cx - 9, topY - 8, 18, 13, 2);
      g.fillStyle(0x4aa3ff, 0.95);
      g.fillRect(cx - 7, topY - 6, 14, 9);
      g.fillStyle(0x2a3350, 1);
      g.fillRect(cx - 2, topY + 5, 4, 4);
      g.generateTexture(DESK_TEX, 72, 64);
      g.destroy();
    }

    // Kursi iso (kuning, dengan sandaran). 40×42.
    if (!this.textures.exists(CHAIR_TEX)) {
      const g = this.add.graphics();
      const cx = 20;
      const sy = 20;
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(cx, sy + 18, 26, 9);
      // sandaran
      g.fillStyle(0xd9a93c, 1);
      g.fillRoundedRect(cx - 9, sy - 14, 18, 16, 4);
      // dudukan (diamond)
      g.fillStyle(0xf2c14e, 1);
      g.fillPoints(pts([cx, sy - 2], [cx + 16, sy + 6], [cx, sy + 14], [cx - 16, sy + 6]), true);
      g.generateTexture(CHAIR_TEX, 40, 44);
      g.destroy();
    }

    // Tanaman pot (40×56).
    if (!this.textures.exists(PLANT_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(20, 52, 26, 8);
      g.fillStyle(0x8a5a32, 1);
      g.fillRect(10, 38, 20, 14);
      g.fillStyle(0x6e4626, 1);
      g.fillRect(10, 38, 20, 4);
      g.fillStyle(0x2f9e54, 1);
      g.fillCircle(20, 26, 14);
      g.fillCircle(11, 31, 9);
      g.fillCircle(29, 31, 9);
      g.fillStyle(0x37b362, 1);
      g.fillCircle(20, 16, 10);
      g.generateTexture(PLANT_TEX, 40, 56);
      g.destroy();
    }

    // Mesin minuman (vending) merah (48×78).
    if (!this.textures.exists(VENDING_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.22);
      g.fillEllipse(24, 74, 40, 9);
      g.fillStyle(0xc0392b, 1);
      g.fillRoundedRect(6, 6, 36, 66, 4);
      g.fillStyle(0x922b21, 1);
      g.fillRect(6, 6, 36, 8);
      g.fillStyle(0x12182a, 1);
      g.fillRect(10, 18, 16, 38);
      g.fillStyle(0x4aa3ff, 0.5);
      g.fillRect(12, 20, 12, 34);
      g.fillStyle(0xf2c14e, 1);
      g.fillRect(30, 20, 8, 6);
      g.fillRect(30, 30, 8, 6);
      g.fillRect(30, 40, 8, 6);
      g.fillStyle(0x2a3350, 1);
      g.fillRect(10, 60, 28, 8);
      g.generateTexture(VENDING_TEX, 48, 78);
      g.destroy();
    }

    // Dispenser air (36×62).
    if (!this.textures.exists(COOLER_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.2);
      g.fillEllipse(18, 58, 28, 8);
      g.fillStyle(0xeef2f8, 1);
      g.fillRoundedRect(6, 24, 24, 32, 3);
      g.fillStyle(0x9fd0ff, 0.9);
      g.fillRoundedRect(9, 4, 18, 22, 6);
      g.fillStyle(0x4aa3ff, 0.8);
      g.fillRect(11, 9, 14, 14);
      g.fillStyle(0x2a3350, 1);
      g.fillRect(12, 38, 12, 5);
      g.generateTexture(COOLER_TEX, 36, 62);
      g.destroy();
    }

    // Pintu lift (bersih, mirip referensi) — 64×96.
    if (!this.textures.exists(ELEVATOR_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0x000000, 0.22);
      g.fillEllipse(32, 92, 52, 10); // bayangan
      // rangka luar
      g.fillStyle(0x8b94a8, 1);
      g.fillRoundedRect(4, 4, 56, 86, 4);
      g.fillStyle(0x70788f, 1);
      g.fillRect(4, 4, 56, 4);
      // lintel + indikator lantai
      g.fillStyle(0x2b3450, 1);
      g.fillRect(8, 8, 48, 10);
      g.fillStyle(0x12182a, 1);
      g.fillRect(24, 10, 16, 6);
      g.fillStyle(0x4ade80, 1);
      g.fillRect(26, 12, 12, 2);
      // dua daun pintu terang + highlight tepi + seam tengah
      g.fillStyle(0xe7ecf5, 1);
      g.fillRect(10, 20, 21, 66);
      g.fillRect(33, 20, 21, 66);
      g.fillStyle(0xf5f8fc, 1);
      g.fillRect(10, 20, 21, 3);
      g.fillRect(33, 20, 21, 3);
      g.fillStyle(0xb6bed0, 1);
      g.fillRect(31, 20, 2, 66);
      // panel tombol di sisi kanan
      g.fillStyle(0x2a3350, 1);
      g.fillRoundedRect(54, 46, 6, 16, 2);
      g.fillStyle(0x4ade80, 1);
      g.fillCircle(57, 51, 1.8);
      g.fillStyle(0xff5d6c, 1);
      g.fillCircle(57, 57, 1.8);
      g.generateTexture(ELEVATOR_TEX, 64, 96);
      g.destroy();
    }
  }

  /** Buat animasi walk/idle 4 arah untuk tiap karakter LimeZu yang ter-load (no-op bila gagal). */
  private makeCharAnims(): void {
    const dirs: Dir[] = ["down", "up", "left", "right"];
    for (const name of LZ_CHARS) {
      if (!this.textures.exists(`lz-${name}-walk`)) continue;
      const idleTex = this.textures.exists(`lz-${name}-idle`) ? `lz-${name}-idle` : `lz-${name}-walk`;
      for (const dir of dirs) {
        const s = DIR_FRAMES[dir];
        if (!this.anims.exists(`${name}-walk-${dir}`)) {
          this.anims.create({
            key: `${name}-walk-${dir}`,
            frames: this.anims.generateFrameNumbers(`lz-${name}-walk`, { start: s, end: s + 5 }),
            frameRate: 10,
            repeat: -1,
          });
        }
        if (!this.anims.exists(`${name}-idle-${dir}`)) {
          this.anims.create({
            key: `${name}-idle-${dir}`,
            frames: this.anims.generateFrameNumbers(idleTex, { start: s, end: s + 5 }),
            frameRate: 5,
            repeat: -1,
          });
        }
      }
    }
  }

  /** Petakan spriteKey/role → 1 karakter LimeZu (stabil). null bila aset tak ter-load (→ pawn). */
  private charNameFor(spriteKey: string): string | null {
    let h = 0;
    for (let i = 0; i < spriteKey.length; i++) h = (h * 31 + spriteKey.charCodeAt(i)) | 0;
    const name = LZ_CHARS[Math.abs(h) % LZ_CHARS.length]!;
    return this.textures.exists(`lz-${name}-walk`) ? name : null;
  }

  /** Arah hadap berdasarkan gerak di LAYAR (iso), bukan arah tile, agar hadap terasa benar. */
  private screenDir(fromX: number, fromY: number, toX: number, toY: number): Dir {
    const a = this.tileToIso(fromX, fromY);
    const b = this.tileToIso(toX, toY);
    const dx = b.wx - a.wx;
    const dy = b.wy - a.wy;
    if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
    return dy >= 0 ? "down" : "up";
  }

  private playWalk(obj: CharObj, dir: Dir): void {
    obj.faceDir = dir;
    if (obj.charName) obj.sprite.play(`${obj.charName}-walk-${dir}`, true);
  }

  private playIdle(obj: CharObj): void {
    if (obj.charName) obj.sprite.play(`${obj.charName}-idle-${obj.faceDir}`, true);
  }

  private spawnChar(agent: AgentProfile): CharObj {
    const tile = this.clampTile(agent.deskPos.x, agent.deskPos.y);

    const desk = this.add.image(0, 0, DESK_TEX).setOrigin(0.5, 0.82);
    const chair = this.add.image(0, 0, CHAIR_TEX).setOrigin(0.5, 0.75);

    // Karakter: sprite LimeZu bila ter-load, else fallback "pawn" kode (di-tint per role).
    const charName = this.charNameFor(agent.spriteKey);
    const baseScale = charName ? CHAR_SCALE : 1;
    const sprite = this.add
      .sprite(0, 0, charName ? `lz-${charName}-walk` : CHAR_TEX, 0)
      .setOrigin(0.5, charName ? 1 : 0.92)
      .setScale(baseScale);
    if (!charName) sprite.setTint(colorForSprite(agent.spriteKey));

    const top = charName ? -72 : -42; // posisi label/status menyesuaikan tinggi sprite
    const ring = this.add.ellipse(0, 2, 34, 18, 0xffe066, 0).setStrokeStyle(2, 0xffe066, 0).setVisible(false);
    const label = this.add
      .text(0, top, agent.name, { fontFamily: "Segoe UI, sans-serif", fontSize: "12px", color: "#e6ebf5" })
      .setOrigin(0.5, 1);
    const statusDot = this.add.circle(10, top + 6, 4, STATUS_COLORS.idle, 1).setStrokeStyle(1, 0x0f1420, 1);

    const container = this.add.container(0, 0, [ring, sprite, label, statusDot]);
    const obj: CharObj = {
      container,
      sprite,
      label,
      ring,
      statusDot,
      status: "idle",
      tile,
      desk,
      chair,
      deskTile: { x: tile.x, y: tile.y },
      charName: charName ?? undefined,
      faceDir: "down",
      baseScale,
    };
    this.placeStation(obj);
    this.playIdle(obj);
    this.applyStatus(obj, agent.status);
    return obj;
  }

  /** Tempatkan meja+kursi (di deskTile) & karakter (di tile saat ini) + atur depth iso. */
  private placeStation(obj: CharObj): void {
    const d = this.tileToIso(obj.deskTile.x, obj.deskTile.y);
    const base = this.depthFor(obj.deskTile.x, obj.deskTile.y);
    obj.desk.setPosition(d.wx, d.wy).setDepth(base + SUB_DESK);
    // Kursi di belakang+atas meja → sandaran menyembul di atas meja (depth di bawah meja).
    obj.chair.setPosition(d.wx, d.wy - 24).setDepth(base + SUB_CHAIR);
    this.placeChar(obj);
  }

  /** Posisikan container karakter di petak `tile` saat ini (+offset depan) + depth sesuai (x+y). */
  private placeChar(obj: CharObj): void {
    const c = this.tileToIso(obj.tile.x, obj.tile.y);
    obj.container.setPosition(c.wx, c.wy + CHAR_FRONT_OFFSET);
    obj.container.setDepth(this.depthFor(obj.tile.x, obj.tile.y) + SUB_CHAR);
  }

  setAgentStatus(agentId: string, status: AgentStatus): void {
    const obj = this.chars.get(agentId);
    if (obj) this.applyStatus(obj, status);
  }

  private applyStatus(obj: CharObj, status: AgentStatus): void {
    obj.status = status;
    obj.statusDot.setFillStyle(STATUS_COLORS[status], 1);
    obj.statusTween?.stop();
    delete obj.statusTween;
    obj.sprite.setScale(obj.baseScale);
    if (status === "working") {
      obj.statusTween = this.tweens.add({
        targets: obj.sprite,
        scale: obj.baseScale * 1.12,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
  }

  private handleClick(worldX: number, worldY: number): void {
    // Pilih karakter via HIT-TEST sprite (akurat di iso walau pawn digeser ke depan) — utamakan
    // yang paling depan bila bertumpuk.
    let hitId: string | null = null;
    let hitDepth = -Infinity;
    for (const [id, obj] of this.chars) {
      if (obj.sprite.getBounds().contains(worldX, worldY)) {
        const d = this.depthFor(obj.tile.x, obj.tile.y);
        if (d > hitDepth) {
          hitDepth = d;
          hitId = id;
        }
      }
    }
    if (hitId) {
      this.select(hitId);
      return;
    }
    // Klik LIFT → pindah ke lantai berikutnya (bila kantor punya >1 lantai).
    if (this.elevator && this.elevator.getBounds().contains(worldX, worldY)) {
      this.requestNextFloor();
      return;
    }
    // Selain itu → jalankan yang terpilih ke petak yang diklik (bila walkable).
    const { x: tx, y: ty } = this.isoToTile(worldX, worldY);
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return;
    if (this.selectedId && this.grid[ty]?.[tx] === 0) {
      this.walkTo(this.selectedId, tx, ty);
    }
  }

  private select(id: string): void {
    this.selectedId = id;
    for (const [cid, obj] of this.chars) {
      const on = cid === id;
      obj.ring.setVisible(on).setStrokeStyle(2, 0xffe066, on ? 1 : 0);
    }
  }

  private walkTo(id: string, tx: number, ty: number): void {
    const obj = this.chars.get(id);
    if (obj) {
      obj.roaming = false; // arahan user membatalkan roam ambient.
      this.pathWalk(obj, tx, ty);
    }
  }

  /** Cari jalur (easystar) lalu animasikan container karakter petak-demi-petak (iso). */
  private pathWalk(obj: CharObj, tx: number, ty: number, onArrive?: () => void): void {
    this.easystar.findPath(obj.tile.x, obj.tile.y, tx, ty, (path) => {
      if (!path || path.length < 2) {
        onArrive?.();
        return;
      }
      obj.active?.stop();
      let prev = { x: obj.tile.x, y: obj.tile.y };
      const steps = path.slice(1).map((node) => {
        const from = prev;
        prev = { x: node.x, y: node.y };
        const { wx, wy } = this.tileToIso(node.x, node.y);
        const dir = this.screenDir(from.x, from.y, node.x, node.y);
        return {
          x: wx,
          y: wy + CHAR_FRONT_OFFSET,
          duration: 200,
          onStart: () => this.playWalk(obj, dir),
          onComplete: () => {
            obj.tile = { x: node.x, y: node.y };
            obj.container.setDepth(this.depthFor(node.x, node.y) + SUB_CHAR);
          },
        };
      });
      obj.active = this.tweens.chain({
        targets: obj.container,
        tweens: steps,
        onComplete: () => {
          this.playIdle(obj);
          onArrive?.();
        },
      });
    });
    this.easystar.calculate();
  }

  // ---------------- ambient (roam + obrolan) ----------------

  private readonly bubbleEmojis = ["💬", "👋", "☕", "📊", "✅", "🤔", "📝", "💡"];

  private ambientTick(): void {
    const idle = [...this.chars.values()].filter(
      (o) => o.status === "idle" && !o.roaming && !o.active?.isPlaying(),
    );
    if (idle.length === 0) return;
    const a = idle[Math.floor(Math.random() * idle.length)]!;

    let target: { x: number; y: number } | null = null;
    // 50%: hampiri agent lain (kesan saling berkomunikasi) + gelembung di keduanya.
    if (Math.random() < 0.5 && this.chars.size > 1) {
      const others = [...this.chars.values()].filter((o) => o !== a);
      const b = others[Math.floor(Math.random() * others.length)]!;
      target = this.randomWalkableNear(b.tile.x, b.tile.y, 1);
      if (target) this.showBubble(b);
    }
    // else / gagal: berkeliling acak di sekitar posisi sekarang.
    if (!target) target = this.randomWalkableNear(a.tile.x, a.tile.y, 4);
    if (!target) return;
    this.showBubble(a);
    a.roaming = true;
    this.pathWalk(a, target.x, target.y, () => {
      a.roaming = false;
    });
  }

  /** Petak walkable acak (grid==0) dalam radius dari (tx,ty); null bila tak ketemu. */
  private randomWalkableNear(tx: number, ty: number, radius: number): { x: number; y: number } | null {
    for (let i = 0; i < 16; i++) {
      const nx = tx + Math.round((Math.random() * 2 - 1) * radius);
      const ny = ty + Math.round((Math.random() * 2 - 1) * radius);
      if (
        nx >= 0 &&
        ny >= 0 &&
        nx < this.gridW &&
        ny < this.gridH &&
        this.grid[ny]?.[nx] === 0 &&
        !(nx === tx && ny === ty)
      ) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  /** Gelembung emoji singkat di atas karakter (kesan ngobrol). */
  private showBubble(obj: CharObj): void {
    const e = this.bubbleEmojis[Math.floor(Math.random() * this.bubbleEmojis.length)]!;
    this.showBubbleAt(obj.container.x, obj.container.y - 50, e);
  }

  private showBubbleAt(x: number, y: number, emoji: string): void {
    const txt = this.add.text(x, y, emoji, { fontSize: "18px" }).setOrigin(0.5, 1).setDepth(2_000_000);
    this.tweens.add({
      targets: txt,
      y: y - 14,
      alpha: { from: 1, to: 0 },
      duration: 1500,
      ease: "Sine.Out",
      onComplete: () => txt.destroy(),
    });
  }

  /**
   * Klik lift → minta React (WorldView) pindah ke lantai berikutnya (siklus). Hanya bila ada
   * >1 lantai; selain itu beri isyarat. Scene tak menyimpan pilihan lantai (itu state React) →
   * komunikasi lewat event game `office:request-floor` (didengar WorldView).
   */
  private requestNextFloor(): void {
    if (this.floorsList.length < 2) {
      if (this.elevator) this.showBubbleAt(this.elevator.x, this.elevator.y - 70, "🔼");
      return;
    }
    const idx = this.floorsList.findIndex((f) => f.id === this.currentFloorId);
    const next = this.floorsList[(idx + 1) % this.floorsList.length];
    if (next) this.game.events.emit("office:request-floor", next.id);
  }

  private clampTile(x: number, y: number): { x: number; y: number } {
    const maxX = Math.max(1, this.gridW - 2);
    const maxY = Math.max(1, this.gridH - 2);
    return {
      x: Math.min(Math.max(1, Math.round(x)), maxX),
      y: Math.min(Math.max(1, Math.round(y)), maxY),
    };
  }
}

/** Bantu ringkas titik poligon untuk Graphics.fillPoints. */
function pts(...xy: [number, number][]): Phaser.Types.Math.Vector2Like[] {
  return xy.map(([x, y]) => ({ x, y }));
}
