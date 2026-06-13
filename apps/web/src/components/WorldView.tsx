/**
 * WorldView — host kantor 2D (Phaser). Menggambar karakter dari WorldSnapshot dan
 * memperbaruinya tiap snapshot berubah. Pemilihan lantai bila company punya >1 lantai.
 *
 * Scene Phaser baru valid setelah event `ready` (instansiasi scene asinkron). Kita
 * pegang world/floor di ref agar bisa diterapkan begitu scene siap, dan juga saat
 * snapshot berubah setelahnya.
 */

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, WorldSnapshot } from "@vc/shared";
import { bootGame, type GameHandle } from "../game/bootGame.js";
import { DirectiveComposer } from "./DirectiveComposer.js";

export function WorldView({
  world,
  agentEvent,
  onDirectiveSent,
}: {
  world: WorldSnapshot | null;
  agentEvent?: AgentEvent | null;
  onDirectiveSent?: () => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<GameHandle | null>(null);
  const [floorId, setFloorId] = useState<string>("");

  // Ref selalu menyimpan world/floor terkini (dipakai callback `ready`).
  const worldRef = useRef<WorldSnapshot | null>(world);
  const floorRef = useRef<string>(floorId);
  worldRef.current = world;
  floorRef.current = floorId;

  // Boot Phaser sekali saat mount. Terapkan world saat scene siap (event ready).
  useEffect(() => {
    if (!hostRef.current) return;
    const handle = bootGame(hostRef.current);
    handleRef.current = handle;
    const applyCurrent = (): void => {
      if (worldRef.current) {
        handle.getScene()?.applyWorld(worldRef.current, floorRef.current || undefined);
      }
    };
    handle.game.events.once("ready", applyCurrent);
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

  // Terapkan snapshot ke scene tiap berubah (no-op aman bila scene belum siap).
  useEffect(() => {
    if (!world) return;
    handleRef.current?.getScene()?.applyWorld(world, floorId || undefined);
  }, [world, floorId]);

  // Phase 2.4: event agent → animasi status sprite (working berdenyut, dst).
  useEffect(() => {
    if (!agentEvent || agentEvent.type !== "status") return;
    handleRef.current?.getScene()?.setAgentStatus(agentEvent.agentId, agentEvent.status);
  }, [agentEvent]);

  const agentCount = world
    ? world.agents.filter((a) => {
        const dept = world.departments.find((d) => d.id === a.departmentId);
        return dept && (!floorId || dept.floorId === floorId);
      }).length
    : 0;

  return (
    <div className="world-wrap">
      <div className="world-stage">
        <div id="game-host" ref={hostRef} />
      </div>
      <div className="world-side">
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
        <div style={{ marginTop: 12 }}>
          <DirectiveComposer world={world} {...(onDirectiveSent ? { onSent: onDirectiveSent } : {})} />
        </div>
      </div>
    </div>
  );
}
