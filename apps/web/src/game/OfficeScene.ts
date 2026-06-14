/**
 * OfficeScene — kantor 2D **top-down** dengan aset pixel-art LimeZu Modern Interiors (free).
 *
 * - Lantai & dinding di-tile dari `Room_Builder` (grid dari map Tiled: walkable=lantai, wall=dinding).
 * - Karakter = sprite LimeZu (Adam/…) beranimasi 4 arah; duduk di meja (monitor LimeZu di depan).
 * - Furnitur/dekorasi (monitor, tanaman) = sprite dari sheet `Interiors`.
 * - Klik karakter (hit-test) → pilih; klik lantai → jalan (pathfinding easystarjs). Depth = y (top-down).
 * - Ambient: agent idle berkeliling + gelembung obrolan. Multi-floor via tab Lantai.
 */

import Phaser from "phaser";
import EasyStar from "easystarjs";
import type { AgentProfile, AgentStatus, WorldSnapshot } from "@vc/shared";
import { TILE, colorForSprite } from "./sprites.js";
import { DEFAULT_MAP_KEY, isKnownMapKey, mapPathFor } from "./maps.js";

// ----- tile/aset LimeZu -----
const SRC = 16; // ukuran tile sumber
const TS = 48; // ukuran tile tampil (skala 3×)
const TSCALE = TS / SRC;
const RB_IMG = "lz-rb"; // Room_Builder (tileset image)
const INT_SHEET = "lz-int"; // Interiors (spritesheet 16×16)
const RB_PATH = "assets/tilesets/Modern tiles_Free/Interiors_free/16x16/Room_Builder_free_16x16.png";
const INT_PATH = "assets/tilesets/Modern tiles_Free/Interiors_free/16x16/Interiors_free_16x16.png";
// Indeks tile (dipilih lewat montase + analisis pixel; bisa di-tune).
const FLOOR_IDX = 131; // lantai keramik krem (kalem, bersih — bukan kayu herringbone yg ramai)
const WALL_IDX = 185; // dinding (tekstur)
const INT_MONITOR = 66; // monitor/komputer di stand (Interiors c2,r4) — di depan karakter
const INT_PLANT = 674; // tanaman pot asli (Interiors c2,r42)

// ----- karakter LimeZu -----
const PAWN_TEX = "char-pawn"; // fallback bila aset karakter gagal muat
type Dir = "down" | "up" | "left" | "right";
const LZ_BASE = "assets/tilesets/Modern tiles_Free/Characters_free";
const LZ_CHARS = ["Adam", "Alex", "Amelia", "Bob"] as const;
const LZ_FRAME = { frameWidth: 16, frameHeight: 32 } as const;
const CHAR_SCALE = 3; // 16×32 → 48×96 (1×2 petak)
const DIR_FRAMES: Record<Dir, number> = { down: 0, up: 6, left: 12, right: 18 };

// Hewan ambient: Snow Fox (Basic Asset Pack) — 16×16, 4 frame animasi.
const FOX_SHEET = "fox";
const FOX_PATH =
  "assets/tilesets/Basic Asset Pack/Basic Asset Pack/Basic Animal Animations/Snow Fox/SnowFox.png";

// Workstation: Pixel Life - Desk Essentials (16px). Crop item dari spritesheet (via profil opacity).
const DESKESS = "deskess";
const DESKESS_PATH = "assets/tilesets/Pixel Life - Desk Essentials/spritesheet.png";
const DESK_RECT = { x: 0, y: 0, w: 32, h: 30 }; // meja kayu (2 petak)
const MON_RECT = { x: 102, y: 32, w: 22, h: 31 }; // monitor komputer (layar)
// Tata letak workstation otomatis — CLUSTER (pod 2×2 yang mengelompok, antar-cluster diberi jarak).
const SLOT_X0 = 3;
const SLOT_Y0 = 4;
const SLOT_GX = 3; // jarak antar meja dalam cluster (x)
const SLOT_GY = 4; // jarak antar meja dalam cluster (y)
const CLUSTER_COLS = 2; // meja per baris dalam 1 cluster
const CLUSTER_ROWS = 2; // baris meja dalam 1 cluster (→ 4 meja/cluster)
const CLUSTER_GAP_X = 3; // jarak ekstra antar-cluster (x)
const CHAR_OFF = 14; // karakter digeser ke DEPAN (selatan) → terlihat penuh, meja di belakangnya
const WS_SCALE = 2; // skala furnitur workstation (lebih kecil dari karakter agar tak menutupi)

const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: 0x55607a,
  working: 0x4aa3ff,
  talking: 0x4ade80,
  blocked: 0xf87171,
};

interface CharObj {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Ellipse;
  statusDot: Phaser.GameObjects.Arc;
  statusTween?: Phaser.Tweens.Tween;
  status: AgentStatus;
  tile: { x: number; y: number };
  /** Workstation statis di petak kerja: meja + monitor (Desk Essentials). */
  desk: Phaser.GameObjects.Image;
  monitor: Phaser.GameObjects.Image;
  deskTile: { x: number; y: number };
  active?: Phaser.Tweens.TweenChain;
  roaming?: boolean;
  charName?: string;
  faceDir: Dir;
  baseScale: number;
}

export class OfficeScene extends Phaser.Scene {
  private ready = false;
  private pending: { snapshot: WorldSnapshot; floorId?: string } | null = null;

  private easystar = new EasyStar.js();
  private grid: number[][] = [];
  private gridW = 0;
  private gridH = 0;
  private ox = 0; // offset world agar map ter-center
  private oy = 0;

  private chars = new Map<string, CharObj>();
  private selectedId: string | null = null;

  private floorLayer: Phaser.Tilemaps.TilemapLayer | null = null;
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private gridSrc: Phaser.Tilemaps.Tilemap | null = null; // map Tiled (hanya untuk grid)
  private props: Phaser.GameObjects.Image[] = [];

  // Snow fox ambient (berkeliaran acak).
  private fox?: Phaser.GameObjects.Sprite;
  private foxTile = { x: 2, y: 2 };
  private foxBusy = false;

  private clockText!: Phaser.GameObjects.Text;
  private minutes = 9 * 60;

  private renderedMapKey = DEFAULT_MAP_KEY;
  private desiredMapKey = DEFAULT_MAP_KEY;
  private loadingMapKey: string | null = null;
  private readonly warnedMapKeys = new Set<string>();

  constructor() {
    super("office");
  }

  preload(): void {
    this.load.tilemapTiledJSON(DEFAULT_MAP_KEY, mapPathFor(DEFAULT_MAP_KEY));
    this.load.image(RB_IMG, RB_PATH);
    this.load.spritesheet(INT_SHEET, INT_PATH, { frameWidth: SRC, frameHeight: SRC });
    for (const name of LZ_CHARS) {
      this.load.spritesheet(`lz-${name}-walk`, `${LZ_BASE}/${name}_run_16x16.png`, LZ_FRAME);
      this.load.spritesheet(`lz-${name}-idle`, `${LZ_BASE}/${name}_idle_anim_16x16.png`, LZ_FRAME);
    }
    this.load.spritesheet(FOX_SHEET, FOX_PATH, { frameWidth: 16, frameHeight: 16 });
    this.load.image(DESKESS, DESKESS_PATH);
  }

  create(): void {
    this.makePawnTexture();
    this.makeCharAnims();
    this.makeDeskFrames();
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

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => this.handleClick(p.worldX, p.worldY));
    this.time.addEvent({ delay: 2600, loop: true, callback: () => this.ambientTick() });
    this.spawnFox();
    this.time.addEvent({ delay: 2200, loop: true, callback: () => this.foxWander() });

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
    this.clockText.setText(`🕒 ${hh}:${mm}${sel ? ` · dipilih: ${sel.label.text}` : ""}`);
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

    // Tata letak workstation otomatis per indeks (spasi rapi) — bukan deskPos mentah, agar meja muat.
    agents.forEach((agent, i) => {
      seen.add(agent.id);
      const t = this.slotTile(i);
      const existing = this.chars.get(agent.id);
      if (existing) {
        existing.label.setText(agent.name);
        if (!existing.charName) existing.sprite.setTint(colorForSprite(agent.spriteKey));
        if (t.x !== existing.deskTile.x || t.y !== existing.deskTile.y) {
          existing.active?.stop();
          existing.tile = t;
          existing.deskTile = { x: t.x, y: t.y };
          this.placeStation(existing);
        }
      } else {
        this.chars.set(agent.id, this.spawnChar(agent, t));
      }
    });
    for (const [id, obj] of this.chars) {
      if (!seen.has(id)) {
        obj.active?.stop();
        obj.statusTween?.stop();
        obj.container.destroy();
        obj.desk.destroy();
        obj.monitor.destroy();
        this.chars.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
    if (!this.selectedId && this.chars.size > 0) {
      this.select(this.chars.keys().next().value as string);
    }
  }

  // ---------------- koordinat top-down ----------------

  private tileToWorld(tx: number, ty: number): { wx: number; wy: number } {
    return { wx: this.ox + tx * TS + TS / 2, wy: this.oy + ty * TS + TS / 2 };
  }

  private worldToTile(wx: number, wy: number): { x: number; y: number } {
    return { x: Math.floor((wx - this.ox) / TS), y: Math.floor((wy - this.oy) / TS) };
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
      if (!this.cache.tilemap.exists(assetKey) || assetKey !== this.desiredMapKey) return;
      this.buildMap(assetKey);
      this.renderedMapKey = assetKey;
    });
    this.load.start();
  }

  /** Bangun grid (dari Tiled) + render lantai/dinding LimeZu + dekorasi. */
  private buildMap(cacheKey: string): void {
    // Grid walkability dari map Tiled (layer tak ditampilkan).
    this.gridSrc?.destroy();
    const src = this.make.tilemap({ key: cacheKey });
    this.gridSrc = src;
    this.gridW = src.width;
    this.gridH = src.height;
    // Baca GID langsung dari data layer (tanpa perlu tekstur tileset) untuk grid walkability.
    const ld = src.getLayer("ground");
    this.grid = [];
    for (let y = 0; y < this.gridH; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.gridW; x++) {
        const idx = ld?.data?.[y]?.[x]?.index ?? 0;
        row.push(idx === TILE.WALL_GID ? 1 : 0);
      }
      this.grid.push(row);
    }
    this.easystar.setGrid(this.grid);

    // Offset agar map ter-center di kanvas.
    this.ox = Math.round((this.scale.width - this.gridW * TS) / 2);
    this.oy = Math.round((this.scale.height - this.gridH * TS) / 2);

    // Lantai + dinding (tilemap LimeZu).
    this.floorLayer?.destroy();
    this.tilemap?.destroy();
    const map = this.make.tilemap({ tileWidth: SRC, tileHeight: SRC, width: this.gridW, height: this.gridH });
    const ts = map.addTilesetImage(RB_IMG, RB_IMG, SRC, SRC, 0, 0);
    this.tilemap = map;
    if (ts) {
      const layer = map.createBlankLayer("floor", ts, this.ox, this.oy)!;
      layer.setScale(TSCALE).setDepth(-1_000_000);
      for (let y = 0; y < this.gridH; y++) {
        for (let x = 0; x < this.gridW; x++) {
          layer.putTileAt(this.grid[y]![x] === 1 ? WALL_IDX : FLOOR_IDX, x, y);
        }
      }
      this.floorLayer = layer;
    }

    this.placeProps();
    for (const obj of this.chars.values()) this.placeStation(obj);
  }

  /** Dekorasi ruang (tanaman di sudut) dari sheet Interiors. */
  private placeProps(): void {
    for (const p of this.props) p.destroy();
    this.props = [];
    const W = this.gridW;
    const H = this.gridH;
    const spots: [number, number][] = [
      [1, 1],
      [W - 2, 1],
      [1, H - 2],
      [W - 2, H - 2],
      [Math.floor(W / 2), H - 2],
    ];
    for (const [tx, ty] of spots) {
      if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) continue;
      const { wx, wy } = this.tileToWorld(tx, ty);
      const plant = this.add
        .image(wx, wy + TS / 2, INT_SHEET, INT_PLANT)
        .setOrigin(0.5, 1)
        .setScale(TSCALE)
        .setDepth(wy + TS / 2);
      this.props.push(plant);
    }
  }

  // ---------------- tekstur & animasi karakter ----------------

  private makePawnTexture(): void {
    if (this.textures.exists(PAWN_TEX)) return;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(4, 13, 18, 21, 6);
    g.fillCircle(13, 9, 7);
    g.generateTexture(PAWN_TEX, 26, 38);
    g.destroy();
  }

  /** Definisikan frame crop (meja, monitor) dari spritesheet Desk Essentials. */
  private makeDeskFrames(): void {
    if (!this.textures.exists(DESKESS)) return;
    const tex = this.textures.get(DESKESS);
    if (!tex.has("desk")) tex.add("desk", 0, DESK_RECT.x, DESK_RECT.y, DESK_RECT.w, DESK_RECT.h);
    if (!tex.has("monitor")) tex.add("monitor", 0, MON_RECT.x, MON_RECT.y, MON_RECT.w, MON_RECT.h);
  }

  /** Petak workstation untuk agent ke-`i` (tata letak baris, spasi agar meja muat). */
  private slotTile(i: number): { x: number; y: number } {
    const per = CLUSTER_COLS * CLUSTER_ROWS;
    const c = Math.floor(i / per); // indeks cluster
    const p = i % per; // posisi dalam cluster
    const cc = p % CLUSTER_COLS;
    const cr = Math.floor(p / CLUSTER_COLS);
    const x = SLOT_X0 + c * (CLUSTER_COLS * SLOT_GX + CLUSTER_GAP_X) + cc * SLOT_GX;
    const y = SLOT_Y0 + cr * SLOT_GY;
    return this.clampTile(x, y);
  }

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
    if (this.textures.exists(FOX_SHEET) && !this.anims.exists("fox-walk")) {
      this.anims.create({
        key: "fox-walk",
        frames: this.anims.generateFrameNumbers(FOX_SHEET, { start: 0, end: 3 }),
        frameRate: 6,
        repeat: -1,
      });
    }
  }

  private charNameFor(spriteKey: string): string | null {
    let h = 0;
    for (let i = 0; i < spriteKey.length; i++) h = (h * 31 + spriteKey.charCodeAt(i)) | 0;
    const name = LZ_CHARS[Math.abs(h) % LZ_CHARS.length]!;
    return this.textures.exists(`lz-${name}-walk`) ? name : null;
  }

  /** Arah hadap dari delta petak (top-down): dominan horizontal → left/right, else up/down. */
  private dirFor(dx: number, dy: number): Dir {
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

  // ---------------- karakter ----------------

  private spawnChar(agent: AgentProfile, slot: { x: number; y: number }): CharObj {
    const tile = { x: slot.x, y: slot.y };
    const charName = this.charNameFor(agent.spriteKey);
    const baseScale = charName ? CHAR_SCALE : 1;

    // Workstation: meja + monitor Desk Essentials (fallback monitor LimeZu bila aset tak ada).
    const hasDE = this.textures.exists(DESKESS) && this.textures.get(DESKESS).has("desk");
    const desk = (hasDE ? this.add.image(0, 0, DESKESS, "desk") : this.add.image(0, 0, INT_SHEET, INT_MONITOR))
      .setOrigin(0.5, 1)
      .setScale(WS_SCALE);
    const monitor = (hasDE ? this.add.image(0, 0, DESKESS, "monitor") : this.add.image(0, 0, INT_SHEET, INT_MONITOR))
      .setOrigin(0.5, 1)
      .setScale(WS_SCALE)
      .setVisible(hasDE);

    const sprite = this.add
      .sprite(0, 0, charName ? `lz-${charName}-walk` : PAWN_TEX, 0)
      .setOrigin(0.5, 1)
      .setScale(baseScale);
    if (!charName) sprite.setTint(colorForSprite(agent.spriteKey));

    const ring = this.add.ellipse(0, 0, 40, 20, 0xffe066, 0).setStrokeStyle(2, 0xffe066, 0).setVisible(false);
    const label = this.add
      .text(0, charName ? -96 : -42, agent.name, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "12px",
        color: "#e6ebf5",
        stroke: "#0f1420",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);
    const statusDot = this.add
      .circle(12, charName ? -88 : -36, 4, STATUS_COLORS.idle, 1)
      .setStrokeStyle(1, 0x0f1420, 1);

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
      monitor,
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

  /** Tempatkan monitor (di petak kerja) + karakter (duduk di belakang monitor). Depth = y. */
  private placeStation(obj: CharObj): void {
    const d = this.tileToWorld(obj.deskTile.x, obj.deskTile.y);
    // Workstation di BELAKANG (utara) karakter → orang tetap terlihat PENUH di depan.
    obj.desk.setPosition(d.wx, d.wy - 8).setDepth(d.wy - 8);
    obj.monitor.setPosition(d.wx, d.wy - 16).setDepth(d.wy - 7);
    this.placeChar(obj);
  }

  private placeChar(obj: CharObj): void {
    const c = this.tileToWorld(obj.tile.x, obj.tile.y);
    const feetY = c.wy + CHAR_OFF;
    obj.container.setPosition(c.wx, feetY);
    obj.container.setDepth(feetY);
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
        scale: obj.baseScale * 1.1,
        duration: 450,
        yoyo: true,
        repeat: -1,
        ease: "Sine.InOut",
      });
    }
  }

  // ---------------- interaksi ----------------

  private handleClick(worldX: number, worldY: number): void {
    let hitId: string | null = null;
    let hitDepth = -Infinity;
    for (const [id, obj] of this.chars) {
      if (obj.sprite.getBounds().contains(worldX, worldY) && obj.container.depth > hitDepth) {
        hitDepth = obj.container.depth;
        hitId = id;
      }
    }
    if (hitId) {
      this.select(hitId);
      return;
    }
    const { x: tx, y: ty } = this.worldToTile(worldX, worldY);
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return;
    if (this.selectedId && this.grid[ty]?.[tx] === 0) this.walkTo(this.selectedId, tx, ty);
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
      obj.roaming = false;
      this.pathWalk(obj, tx, ty);
    }
  }

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
        const { wx, wy } = this.tileToWorld(node.x, node.y);
        const dir = this.dirFor(node.x - from.x, node.y - from.y);
        return {
          x: wx,
          y: wy + CHAR_OFF,
          duration: 200,
          onStart: () => this.playWalk(obj, dir),
          onComplete: () => {
            obj.tile = { x: node.x, y: node.y };
            obj.container.setDepth(wy + CHAR_OFF);
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

  // ---------------- ambient ----------------

  private readonly bubbleEmojis = ["💬", "👋", "☕", "📊", "✅", "🤔", "📝", "💡"];

  private ambientTick(): void {
    const idle = [...this.chars.values()].filter(
      (o) => o.status === "idle" && !o.roaming && !o.active?.isPlaying(),
    );
    if (idle.length === 0) return;
    const a = idle[Math.floor(Math.random() * idle.length)]!;
    let target: { x: number; y: number } | null = null;
    if (Math.random() < 0.5 && this.chars.size > 1) {
      const others = [...this.chars.values()].filter((o) => o !== a);
      const b = others[Math.floor(Math.random() * others.length)]!;
      target = this.randomWalkableNear(b.tile.x, b.tile.y, 1);
      if (target) this.showBubble(b);
    }
    if (!target) target = this.randomWalkableNear(a.tile.x, a.tile.y, 4);
    if (!target) return;
    this.showBubble(a);
    a.roaming = true;
    this.pathWalk(a, target.x, target.y, () => {
      a.roaming = false;
    });
  }

  // ---------------- snow fox (hewan ambient) ----------------

  private spawnFox(): void {
    if (this.fox || !this.textures.exists(FOX_SHEET)) return;
    const s = this.randomWalkableNear(Math.floor(this.gridW / 2), Math.floor(this.gridH / 2), 6) ?? {
      x: 2,
      y: 2,
    };
    this.foxTile = s;
    const { wx, wy } = this.tileToWorld(s.x, s.y);
    this.fox = this.add.sprite(wx, wy + 8, FOX_SHEET, 0).setScale(2.4).setDepth(wy + 8);
    if (this.anims.exists("fox-walk")) this.fox.play("fox-walk");
  }

  private foxWander(): void {
    if (!this.fox || this.foxBusy) return;
    const t = this.randomWalkableNear(this.foxTile.x, this.foxTile.y, 5);
    if (!t) return;
    this.easystar.findPath(this.foxTile.x, this.foxTile.y, t.x, t.y, (path) => {
      if (!this.fox || !path || path.length < 2) return;
      this.foxBusy = true;
      let prev = { x: this.foxTile.x, y: this.foxTile.y };
      const steps = path.slice(1).map((node) => {
        const from = prev;
        prev = { x: node.x, y: node.y };
        const { wx, wy } = this.tileToWorld(node.x, node.y);
        return {
          x: wx,
          y: wy + 8,
          duration: 260,
          onStart: () => {
            if (this.fox && node.x !== from.x) this.fox.setFlipX(node.x < from.x);
          },
          onComplete: () => {
            this.foxTile = { x: node.x, y: node.y };
            this.fox?.setDepth(wy + 8);
          },
        };
      });
      this.tweens.chain({
        targets: this.fox,
        tweens: steps,
        onComplete: () => {
          this.foxBusy = false;
        },
      });
    });
    this.easystar.calculate();
  }

  private randomWalkableNear(tx: number, ty: number, radius: number): { x: number; y: number } | null {
    for (let i = 0; i < 16; i++) {
      const nx = tx + Math.round((Math.random() * 2 - 1) * radius);
      const ny = ty + Math.round((Math.random() * 2 - 1) * radius);
      if (nx >= 0 && ny >= 0 && nx < this.gridW && ny < this.gridH && this.grid[ny]?.[nx] === 0 && !(nx === tx && ny === ty)) {
        return { x: nx, y: ny };
      }
    }
    return null;
  }

  private showBubble(obj: CharObj): void {
    const e = this.bubbleEmojis[Math.floor(Math.random() * this.bubbleEmojis.length)]!;
    const txt = this.add
      .text(obj.container.x, obj.container.y - (obj.charName ? 104 : 50), e, { fontSize: "18px" })
      .setOrigin(0.5, 1)
      .setDepth(2_000_000);
    this.tweens.add({
      targets: txt,
      y: txt.y - 14,
      alpha: { from: 1, to: 0 },
      duration: 1500,
      ease: "Sine.Out",
      onComplete: () => txt.destroy(),
    });
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
