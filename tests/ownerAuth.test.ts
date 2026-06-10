import { describe, it, expect } from "vitest";
import { OwnerAuth, normalizeNumber, ownerAuthFromEnv } from "@vc/server";

describe("normalizeNumber", () => {
  it("hanya menyisakan digit", () => {
    expect(normalizeNumber("+62 812-3456-7890")).toBe("6281234567890");
    expect(normalizeNumber("(021) 555 1234")).toBe("0215551234");
    expect(normalizeNumber("whatsapp:+1.555.000")).toBe("1555000");
  });
});

describe("OwnerAuth", () => {
  it("mengizinkan owner lintas format penulisan", () => {
    const auth = new OwnerAuth(["+62 812-3456-7890"]);
    // Cloud API kirim tanpa "+".
    expect(auth.isAllowed("6281234567890")).toBe(true);
    expect(auth.isAllowed("+6281234567890")).toBe(true);
  });

  it("menolak nomor tak dikenal & string kosong", () => {
    const auth = new OwnerAuth(["+6281234567890"]);
    expect(auth.isAllowed("+15550001111")).toBe(false);
    expect(auth.isAllowed("")).toBe(false);
    expect(auth.isAllowed("abc")).toBe(false);
  });

  it("ownerAuthFromEnv memecah daftar koma & abaikan kosong", () => {
    const auth = ownerAuthFromEnv("+6281, , +6282 ,");
    expect(auth.size).toBe(2);
    expect(auth.isAllowed("6281")).toBe(true);
    expect(auth.isAllowed("6282")).toBe(true);
  });

  it("daftar kosong menolak semua", () => {
    const auth = ownerAuthFromEnv("");
    expect(auth.size).toBe(0);
    expect(auth.isAllowed("6281234567890")).toBe(false);
  });
});
