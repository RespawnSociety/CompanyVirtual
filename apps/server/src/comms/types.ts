/**
 * Kontrak comms (plan §3.3): `ChannelAdapter`, `WhatsAppAdapter`, `InternalBusAdapter`.
 * Adapter mengisolasi detail kanal (Cloud API / Baileys / mock) dari logika relay.
 */

import type { CommsChannel } from "@vc/shared";

/** Pesan masuk dari pengguna (sudah dinormalisasi dari payload mentah kanal). */
export interface InboundMessage {
  /** Nomor/handle pengirim (mentah dari kanal; di-normalisasi oleh OwnerAuth). */
  from: string;
  /** Nomor/handle tujuan (nomor perusahaan), bila tersedia. */
  to?: string;
  text: string;
  /** Id pesan dari kanal (untuk dedup/threading). */
  messageId?: string;
  /** Epoch ms. */
  timestamp: number;
  /** Payload mentah (untuk debugging/audit). */
  raw?: unknown;
}

/** Pesan keluar yang dikirim adapter. */
export interface OutboundMessage {
  to: string;
  text: string;
}

/** Adapter kanal komunikasi. */
export interface ChannelAdapter {
  readonly channel: CommsChannel;
  /** Kirim pesan keluar lewat kanal. */
  send(msg: OutboundMessage): Promise<void>;
}
