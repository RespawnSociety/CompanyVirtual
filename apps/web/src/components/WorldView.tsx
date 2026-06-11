/**
 * WorldView — host kantor 2D (Phaser). Menggambar karakter dari WorldSnapshot dan
 * memperbaruinya tiap snapshot berubah. Pemilihan lantai bila company punya >1 lantai.
 */

import { useEffect, useRef, useState } from "react";
import type { WorldSnapshot } from "@vc/shared";
import { bootGame, type GameHandle } from "../game/bootGame.js";

export function WorldView({ world }: { world: WorldSnapshot | null }): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [floorId, setFloorId] = useState<string>("");

  // Boot Phaser sekali saat mount.
  useEffect(() => {
    if (!hostRef.current) return;
    const handle = bootGame(hostRef.current);
    handleRef.current = handle;
    return () => {
      handle.destroy();
      handleRef.current = null;
    };
  }, []);

  // Default lantai = lantai pertama saat world berganti.
  useEffect(() => {
    if (!world) return;
    const exists = world.floors.some((f) => f.id === floorId);
    if (!exists) setFloorId(world.floors[0]?.id ?? "");
  }, [world, floorId]);

  // Terapkan snapshot ke scene tiap berubah.
  useEffect(() => {
    if (!handleRef.current || !world) return;
    handleRef.current.scene.applyWorld(world, floorId || undefined);
  }, [world, floorId]);

  const agentCount = world
    ? world.agents.filter((a) => {
        const dept = world.departments.find((d) => d.id === a.departmentId);
        return dept && (!floorId || dept.floorId === floorId);
      }).length
    : 0;

  return (
    <div className="world-wrap">
      <div>
        <div id="game-host" ref={hostRef} />
      </div>
      <div>
        <div className="panel" style={{ minWidth: 240 }}>
          <h2>Lantai</h2>
          {!world || world.floors.length === 0 ? (
            <p className="muted">Belum ada lantai. Buat company & tambah lantai di tab Company.</p>
          ) : (
            <>
              <select value={floorId} onChange={(e) => setFloorId(e.target.value)}>
                {world.floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} (lt. {f.index})
                  </option>
                ))}
              </select>
              <p className="hint">{agentCount} karakter di lantai ini.</p>
            </>
          )}
          <p className="hint">
            Klik <b>karakter</b> untuk memilih, lalu klik <b>petak lantai</b> untuk menyuruhnya
            berjalan (pathfinding menghindari dinding).
          </p>
        </div>
      </div>
    </div>
  );
}
