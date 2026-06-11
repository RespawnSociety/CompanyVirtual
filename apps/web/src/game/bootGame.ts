/**
 * Boot Phaser game + akses scene OfficeScene. Dipakai komponen React WorldView.
 */

import Phaser from "phaser";
import { OfficeScene } from "./OfficeScene.js";
import { TILE } from "./sprites.js";

const MAP_W = 20;
const MAP_H = 14;

export interface GameHandle {
  game: Phaser.Game;
  scene: OfficeScene;
  destroy: () => void;
}

export function bootGame(parent: HTMLElement): GameHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: MAP_W * TILE.WIDTH,
    height: MAP_H * TILE.HEIGHT,
    backgroundColor: "#0f1420",
    pixelArt: true,
    scene: [OfficeScene],
  });

  const scene = game.scene.getScene("office") as OfficeScene;
  return {
    game,
    scene,
    destroy: () => game.destroy(true),
  };
}
