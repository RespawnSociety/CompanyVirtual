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
import type { AgentProfile, AgentStatus, WorldSnapshot } from "@vc/shared";
import { TILE, TILE_COLORS, colorForSprite } from "./sprites.js";
import { DEFAULT_MAP_KEY, isKnownMapKey, mapPathFor } from "./maps.js";

const TILESET_TEX = "tiles-gen"; // tileset untuk layer grid (disembunyikan)
const CHAR_TEX = "char-iso"; // pawn karakter
const DESK_TEX = "desk-iso"; // meja + monitor (iso)
const CHAIR_TEX = "chair-iso"; // kursi (iso)
const FLOOR_TEX = "floor-iso"; // ubin lantai diamond

// Dimensi ubin isometrik (diamond 2:1).
const ISO_W = 64;
const ISO_H = 32;
const WALL_H = 64; // tinggi dinding belakang
// Sub-lapisan depth pada satu petak (chair < character < desk → orang tampak duduk di meja).
const D_FLOOR = -100000;
const D_WALL = -90000;
const SUB_CHAIR = 2;
const SUB_CHAR = 4;
const SUB_DESK = 6;

interface CharObj {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
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

  // Objek lantai + dinding (digambar ulang tiap ganti lantai).
  private floorTiles: Phaser.GameObjects.Image[] = [];
  private roomGfx: Phaser.GameObjects.Graphics | null = null;

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
  }

  create(): void {
    this.makeTextures();
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
        existing.sprite.setTint(colorForSprite(agent.spriteKey));
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
  }

  private spawnChar(agent: AgentProfile): CharObj {
    const tile = this.clampTile(agent.deskPos.x, agent.deskPos.y);

    const desk = this.add.image(0, 0, DESK_TEX).setOrigin(0.5, 0.82);
    const chair = this.add.image(0, 0, CHAIR_TEX).setOrigin(0.5, 0.75);

    const ring = this.add.ellipse(0, 2, 34, 18, 0xffe066, 0).setStrokeStyle(2, 0xffe066, 0).setVisible(false);
    const sprite = this.add.image(0, 0, CHAR_TEX).setOrigin(0.5, 0.92).setTint(colorForSprite(agent.spriteKey));
    const label = this.add
      .text(0, -42, agent.name, { fontFamily: "Segoe UI, sans-serif", fontSize: "12px", color: "#e6ebf5" })
      .setOrigin(0.5, 1);
    const statusDot = this.add.circle(10, -36, 4, STATUS_COLORS.idle, 1).setStrokeStyle(1, 0x0f1420, 1);

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
    };
    this.placeStation(obj);
    this.applyStatus(obj, agent.status);
    return obj;
  }

  /** Tempatkan meja+kursi (di deskTile) & karakter (di tile saat ini) + atur depth iso. */
  private placeStation(obj: CharObj): void {
    const d = this.tileToIso(obj.deskTile.x, obj.deskTile.y);
    const base = this.depthFor(obj.deskTile.x, obj.deskTile.y);
    obj.desk.setPosition(d.wx, d.wy).setDepth(base + SUB_DESK);
    obj.chair.setPosition(d.wx, d.wy + 4).setDepth(base + SUB_CHAIR);
    this.placeChar(obj);
  }

  /** Posisikan container karakter di petak `tile` saat ini + depth sesuai (x+y). */
  private placeChar(obj: CharObj): void {
    const c = this.tileToIso(obj.tile.x, obj.tile.y);
    obj.container.setPosition(c.wx, c.wy);
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
    obj.sprite.setScale(1);
    if (status === "working") {
      obj.statusTween = this.tweens.add({
        targets: obj.sprite,
        scale: 1.14,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
  }

  private handleClick(worldX: number, worldY: number): void {
    const { x: tx, y: ty } = this.isoToTile(worldX, worldY);
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return;

    for (const [id, obj] of this.chars) {
      if (obj.tile.x === tx && obj.tile.y === ty) {
        this.select(id);
        return;
      }
    }
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
    if (!obj) return;
    this.easystar.findPath(obj.tile.x, obj.tile.y, tx, ty, (path) => {
      if (!path || path.length < 2) return;
      obj.active?.stop();
      const steps = path.slice(1).map((node) => {
        const { wx, wy } = this.tileToIso(node.x, node.y);
        return {
          x: wx,
          y: wy,
          duration: 170,
          onComplete: () => {
            obj.tile = { x: node.x, y: node.y };
            obj.container.setDepth(this.depthFor(node.x, node.y) + SUB_CHAR);
          },
        };
      });
      obj.active = this.tweens.chain({ targets: obj.container, tweens: steps });
    });
    this.easystar.calculate();
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
