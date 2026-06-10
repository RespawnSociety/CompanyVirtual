import { describe, it, expect, vi } from "vitest";
import { MockWhatsAppAdapter, OwnerAuth, WaRelay } from "@vc/server";
import type { MessageHandler } from "@vc/server";

const OWNER = "+6281234567890";
const STRANGER = "+15550001111";

function setup(opts: { unknownReply?: string | null; handler: MessageHandler }) {
  const adapter = new MockWhatsAppAdapter();
  const relay = new WaRelay({
    adapter,
    ownerAuth: new OwnerAuth([OWNER]),
    handler: opts.handler,
    ...(opts.unknownReply !== undefined ? { unknownReply: opts.unknownReply } : {}),
    log: () => {},
  });
  return { adapter, relay };
}

describe("WaRelay — owner auth + auto-reply", () => {
  it("owner → handler dipanggil & balasan terkirim", async () => {
    const handler = vi.fn(() => Promise.resolve("balasan otomatis"));
    const { adapter, relay } = setup({ handler });

    const out = await relay.handleInbound(adapter.makeInbound(OWNER, "halo", 1));
    expect(out).toEqual({ authorized: true, action: "replied", reply: "balasan otomatis" });
    expect(handler).toHaveBeenCalledOnce();
    expect(adapter.lastSent()).toEqual({ to: OWNER, text: "balasan otomatis" });
  });

  it("nomor lain → ditolak, handler TIDAK dipanggil (tak menyetir agent)", async () => {
    const handler = vi.fn(() => Promise.resolve("seharusnya tak keluar"));
    const { adapter, relay } = setup({ handler, unknownReply: null });

    const out = await relay.handleInbound(adapter.makeInbound(STRANGER, "kendalikan agent", 1));
    expect(out.authorized).toBe(false);
    expect(out.action).toBe("rejected_unknown_ignored");
    expect(handler).not.toHaveBeenCalled();
    expect(adapter.sent).toHaveLength(0);
  });

  it("nomor lain dengan unknownReply → kirim balasan default, handler tetap tak dipanggil", async () => {
    const handler = vi.fn(() => Promise.resolve("x"));
    const { adapter, relay } = setup({ handler, unknownReply: "Maaf, tidak terdaftar." });

    const out = await relay.handleInbound(adapter.makeInbound(STRANGER, "halo", 1));
    expect(out.action).toBe("rejected_unknown_default_reply");
    expect(handler).not.toHaveBeenCalled();
    expect(adapter.lastSent()).toEqual({ to: STRANGER, text: "Maaf, tidak terdaftar." });
  });

  it("owner tapi handler tak membalas (null) → no_reply, tidak ada kiriman", async () => {
    const { adapter, relay } = setup({ handler: () => Promise.resolve(null) });
    const out = await relay.handleInbound(adapter.makeInbound(OWNER, "halo", 1));
    expect(out.action).toBe("no_reply");
    expect(adapter.sent).toHaveLength(0);
  });
});
