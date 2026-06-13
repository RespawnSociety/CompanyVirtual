/**
 * Boot Phaser game + akses scene OfficeScene. Dipakai komponen React WorldView.
 *
 * PENTING: Phaser meng-instansiasi scene config secara ASINKRON (di-proses saat
 * event `READY`, bukan saat `new Phaser.Game()`). Karena itu jangan menyimpan
 * referensi scene saat boot — sediakan `getScene()` lazy yang aman dipanggil kapan
 * pun (mengembalikan null sampai scene siap). WorldView memakai event `ready` +
 * getScene; OfficeScene.applyWorld sendiri mem-buffer (pending) bila create() belum jalan.
 */

import Phaser from "phaser";
import { OfficeScene } from "./OfficeScene.js";

// Resolusi dasar (render) — diperbesar untuk menampung board ISOMETRIK 20×14 (Phase 6).
// Canvas di-skala FIT ke kontainer (lihat styles.css #game-host aspect-ratio sama).
const BASE_W = 1152;
const BASE_H = 704;

export interface GameHandle {
  game: Phaser.Game;
  /** Lazy: null sampai Phaser memproses scene (setelah event READY). */
  getScene: () => OfficeScene | null;
  destroy: () => void;
}

export function bootGame(parent: HTMLElement): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: BASE_W,
    height: BASE_H,
    backgroundColor: "#0f1420",
    pixelArt: true,
    // Phase 6.2: skala canvas mengikuti ukuran kontainer (responsif) sambil menjaga rasio.
    // Mode FIT: Phaser yang mengelola ukuran tampilan canvas DAN memetakan koordinat pointer
    // kembali ke resolusi dasar (MAP_W×MAP_H tile), jadi klik-untuk-berjalan tetap akurat
    // di layar kecil/besar. Resolusi internal (logika tile/pathfinding) tak berubah.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [OfficeScene],
  });

  return {
    game,
    getScene: () => (game.scene.getScene("office") as OfficeScene | null) ?? null,
    destroy: () => game.destroy(true),
  };
}
