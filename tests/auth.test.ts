/**
 * Phase 4 — Auth boundary (BUG-107/108 + CR-101). Unit: helper bearer/socket token.
 * Integrasi: RealtimeHub menolak socket tanpa token & menerima dgn token valid (BUG-108).
 */

import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket } from "socket.io-client";
import { hasValidBearer, hasValidSocketToken, safeEqual, RealtimeHub, type ConfigStore } from "@vc/server";

describe("Phase 4 — auth helper (CR-101)", () => {
  it("safeEqual: sama → true, beda/panjang beda → false", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("hasValidBearer: hanya 'Bearer <token>' yang cocok", () => {
    expect(hasValidBearer("Bearer secret", "secret")).toBe(true);
    expect(hasValidBearer("Bearer salah", "secret")).toBe(false);
    expect(hasValidBearer("secret", "secret")).toBe(false); // tanpa prefix
    expect(hasValidBearer(undefined, "secret")).toBe(false);
  });

  it("hasValidSocketToken: handshake auth.token ATAU header Authorization", () => {
    expect(hasValidSocketToken("secret", undefined, "secret")).toBe(true);
    expect(hasValidSocketToken(undefined, "Bearer secret", "secret")).toBe(true);
    expect(hasValidSocketToken("salah", "Bearer salah", "secret")).toBe(false);
    expect(hasValidSocketToken(undefined, undefined, "secret")).toBe(false);
  });
});

describe("Phase 4 — RealtimeHub auth (BUG-108)", () => {
  const stubStore = { getWorldSnapshot: () => Promise.resolve(undefined) } as unknown as ConfigStore;
  let server: Server | undefined;
  let hub: RealtimeHub | undefined;
  const clients: Socket[] = [];

  afterEach(async () => {
    for (const c of clients) c.close();
    clients.length = 0;
    if (hub) await hub.close();
    if (server) await new Promise<void>((res) => server!.close(() => res()));
    hub = undefined;
    server = undefined;
  });

  async function startHub(token?: string): Promise<number> {
    server = createServer();
    hub = new RealtimeHub(server, stubStore, true, token);
    await new Promise<void>((res) => server!.listen(0, "127.0.0.1", res));
    return (server!.address() as AddressInfo).port;
  }

  function connect(port: number, auth?: { token: string }): Socket {
    const c = ioClient(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      ...(auth ? { auth } : {}),
    });
    clients.push(c);
    return c;
  }

  it("token di-set + socket TANPA token → ditolak (connect_error)", async () => {
    const port = await startHub("secret");
    const c = connect(port);
    const err = await new Promise<Error>((resolve, reject) => {
      c.on("connect_error", resolve);
      c.on("connect", () => reject(new Error("seharusnya ditolak")));
    });
    expect(err.message).toMatch(/unauthorized/i);
  });

  it("token di-set + socket dgn token valid → connect", async () => {
    const port = await startHub("secret");
    const c = connect(port, { token: "secret" });
    await new Promise<void>((resolve, reject) => {
      c.on("connect", () => resolve());
      c.on("connect_error", (e) => reject(e));
    });
    expect(c.connected).toBe(true);
  });

  it("tanpa token (dev lokal) → socket diterima tanpa auth", async () => {
    const port = await startHub(undefined);
    const c = connect(port);
    await new Promise<void>((resolve, reject) => {
      c.on("connect", () => resolve());
      c.on("connect_error", (e) => reject(e));
    });
    expect(c.connected).toBe(true);
  });
});
