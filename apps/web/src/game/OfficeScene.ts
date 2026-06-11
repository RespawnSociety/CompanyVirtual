/**
 * OfficeScene — kantor 2D (plan §2, roadmap 1.1).
 *
 * - Memuat map Tiled (JSON) → render lantai dengan tileset yang dibuat runtime.
 * - Karakter dibuat dari WorldSnapshot (data-driven, dari Configuration layer).
 * - Klik karakter untuk memilih; klik petak lantai → karakter berjalan (pathfinding easystarjs).
 * - HUD: jam in-game + karakter terpilih.
 *
 * Belum ada agent "hidup" (itu Phase 2); ini murni shell spasial + animasi jalan.
 */

import Phaser from "phaser";
import EasyStar from "easystarjs";
import type { AgentProfile, WorldSnapshot } from "@vc/shared";
import { TILE, TILE_COLORS, colorForSprite } from "./sprites.js";

const TILESET_TEX = "tiles-gen";
const CHAR_TEX = "char-gen";
const MAP_KEY = "office-map";

interface CharObj {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Image;
  label: Phaser.GameObjects.Text;
  ring: Phaser.GameObjects.Arc;
  tile: { x: number; y: number };
  active?: Phaser.Tweens.TweenChain;
}

export class OfficeScene extends Phaser.Scene {
  private ready = false;
  private pending: { snapshot: WorldSnapshot; floorId?: string } | null = null;

  private easystar = new EasyStar.js();
  private grid: number[][] = [];
  private gridW = 0;
  private gridH = 0;

  private chars = new Map<string, CharObj>();
  private selectedId: string | null = null;

  private clockText!: Phaser.GameObjects.Text;
  private minutes = 9 * 60; // mulai 09:00

  constructor() {
    super("office");
  }

  preload(): void {
    this.load.tilemapTiledJSON(MAP_KEY, "assets/maps/office.json");
  }

  create(): void {
    this.makeTextures();

    const map = this.make.tilemap({ key: MAP_KEY });
    const tileset = map.addTilesetImage("office", TILESET_TEX);
    if (tileset) {
      const layer = map.createLayer("ground", tileset, 0, 0);
      this.gridW = map.width;
      this.gridH = map.height;
      this.buildGrid(layer);
    }

    this.easystar.setGrid(this.grid);
    this.easystar.setAcceptableTiles([0]);
    this.easystar.enableSync();

    // HUD jam (atas-kiri, tidak ikut scroll).
    this.clockText = this.add
      .text(8, 8, "", {
        fontFamily: "Consolas, monospace",
        fontSize: "13px",
        color: "#e6ebf5",
        backgroundColor: "#0f1420cc",
        padding: { x: 6, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(1000);

    // Input: klik karakter = pilih; klik lantai = jalan ke sana.
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
    // 1 detik nyata = 2 menit in-game (sekadar agar HUD bergerak terlihat).
    this.minutes = (this.minutes + (delta / 1000) * 2) % (24 * 60);
    const hh = String(Math.floor(this.minutes / 60)).padStart(2, "0");
    const mm = String(Math.floor(this.minutes % 60)).padStart(2, "0");
    const sel = this.selectedId ? this.chars.get(this.selectedId) : undefined;
    const who = sel ? ` · dipilih: ${sel.label.text}` : "";
    this.clockText.setText(`🕒 ${hh}:${mm}${who}`);
  }

  /** Render/refresh karakter dari snapshot. Aman dipanggil sebelum create selesai. */
  applyWorld(snapshot: WorldSnapshot, floorId?: string): void {
    if (!this.ready) {
      this.pending = { snapshot, ...(floorId ? { floorId } : {}) };
      return;
    }
    const targetFloor = floorId ?? snapshot.floors[0]?.id;
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
      } else {
        this.chars.set(agent.id, this.spawnChar(agent));
      }
    }
    // Buang karakter yang sudah tak ada di config.
    for (const [id, obj] of this.chars) {
      if (!seen.has(id)) {
        obj.active?.stop();
        obj.container.destroy();
        this.chars.delete(id);
        if (this.selectedId === id) this.selectedId = null;
      }
    }
    // Auto-pilih karakter pertama agar klik-jalan langsung bisa dicoba.
    if (!this.selectedId && this.chars.size > 0) {
      this.select(this.chars.keys().next().value as string);
    }
  }

  // ---------------- internal ----------------

  private makeTextures(): void {
    if (!this.textures.exists(TILESET_TEX)) {
      const g = this.add.graphics();
      for (let i = 0; i < TILE_COLORS.length; i++) {
        g.fillStyle(TILE_COLORS[i]!, 1);
        g.fillRect(i * TILE.WIDTH, 0, TILE.WIDTH, TILE.HEIGHT);
        // garis grid tipis pada tile lantai.
        if (i === 0) {
          g.lineStyle(1, 0x3a4668, 0.5);
          g.strokeRect(i * TILE.WIDTH + 0.5, 0.5, TILE.WIDTH - 1, TILE.HEIGHT - 1);
        }
      }
      g.generateTexture(TILESET_TEX, TILE.WIDTH * TILE_COLORS.length, TILE.HEIGHT);
      g.destroy();
    }
    if (!this.textures.exists(CHAR_TEX)) {
      const g = this.add.graphics();
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(0, 0, 22, 22, 6);
      g.generateTexture(CHAR_TEX, 22, 22);
      g.destroy();
    }
  }

  private buildGrid(layer: Phaser.Tilemaps.TilemapLayer | null): void {
    this.grid = [];
    for (let y = 0; y < this.gridH; y++) {
      const row: number[] = [];
      for (let x = 0; x < this.gridW; x++) {
        const tile = layer?.getTileAt(x, y);
        row.push(tile && tile.index === TILE.WALL_GID ? 1 : 0);
      }
      this.grid.push(row);
    }
  }

  private spawnChar(agent: AgentProfile): CharObj {
    const tile = this.clampTile(agent.deskPos.x, agent.deskPos.y);
    const { wx, wy } = this.tileToWorld(tile.x, tile.y);

    const ring = this.add.circle(0, 0, 15, 0xffffff, 0).setStrokeStyle(2, 0xffe066, 0).setVisible(false);
    const sprite = this.add.image(0, 0, CHAR_TEX).setTint(colorForSprite(agent.spriteKey));
    const label = this.add
      .text(0, -20, agent.name, {
        fontFamily: "Segoe UI, sans-serif",
        fontSize: "11px",
        color: "#e6ebf5",
      })
      .setOrigin(0.5, 1);

    const container = this.add.container(wx, wy, [ring, sprite, label]).setDepth(10);
    return { container, sprite, label, ring, tile };
  }

  private handleClick(worldX: number, worldY: number): void {
    const tx = Math.floor(worldX / TILE.WIDTH);
    const ty = Math.floor(worldY / TILE.HEIGHT);
    if (tx < 0 || ty < 0 || tx >= this.gridW || ty >= this.gridH) return;

    // Klik di petak karakter → pilih karakter itu.
    for (const [id, obj] of this.chars) {
      if (obj.tile.x === tx && obj.tile.y === ty) {
        this.select(id);
        return;
      }
    }
    // Selain itu → jalankan karakter terpilih ke petak (bila walkable).
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
        const { wx, wy } = this.tileToWorld(node.x, node.y);
        return { x: wx, y: wy, duration: 170 };
      });
      const last = path[path.length - 1]!;
      obj.tile = { x: last.x, y: last.y };
      obj.active = this.tweens.chain({ targets: obj.container, tweens: steps });
    });
    this.easystar.calculate();
  }

  private tileToWorld(tx: number, ty: number): { wx: number; wy: number } {
    return { wx: tx * TILE.WIDTH + TILE.WIDTH / 2, wy: ty * TILE.HEIGHT + TILE.HEIGHT / 2 };
  }

  private clampTile(x: number, y: number): { x: number; y: number } {
    const cx = Math.min(Math.max(1, Math.round(x)), this.gridW - 2 || 1);
    const cy = Math.min(Math.max(1, Math.round(y)), this.gridH - 2 || 1);
    return { x: cx, y: cy };
  }
}
