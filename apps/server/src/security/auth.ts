/**
 * Helper auth bersama (CR-101, Phase 4) — satu sumber kebenaran validasi bearer token untuk
 * REST (`server.ts`) DAN realtime Socket.IO (`realtime.ts`). Sebelumnya `hasValidBearer` hanya
 * ada di `server.ts` sehingga socket tak ikut terlindungi (BUG-108).
 *
 * Perbandingan token dilakukan waktu-konstan (`timingSafeEqual`) untuk mencegah timing attack.
 */

import { timingSafeEqual } from "node:crypto";

/** Bandingkan dua string rahasia waktu-konstan (cek panjang dulu krn timingSafeEqual butuh sama). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Validasi header `Authorization: Bearer <token>` terhadap token yang dikonfigurasi. */
export function hasValidBearer(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) return false;
  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) return false;
  return safeEqual(authHeader.slice(prefix.length).trim(), token);
}

/**
 * Validasi token dari handshake Socket.IO. Klien boleh mengirim lewat `socket.handshake.auth.token`
 * ATAU header `Authorization: Bearer <token>`. Mengembalikan true bila salah satu cocok.
 */
export function hasValidSocketToken(
  handshakeAuthToken: unknown,
  authHeader: string | undefined,
  token: string,
): boolean {
  if (typeof handshakeAuthToken === "string" && safeEqual(handshakeAuthToken, token)) return true;
  return hasValidBearer(authHeader, token);
}
