/**
 * Owner Auth (plan §7.3) — HANYA nomor terdaftar (owner/whitelist) yang boleh
 * memberi arahan & approval. Tanpa ini, siapa pun yang chat ke nomor perusahaan
 * bisa menyetir agent. NON-NEGOTIABLE.
 *
 * Normalisasi: WhatsApp Cloud API mengirim `from` sebagai digit tanpa "+"
 * (mis. "6281234567890"), sedangkan owner sering ditulis "+62 812-3456-7890".
 * Kita bandingkan hanya digit-nya.
 */

/** Ambil hanya digit dari nomor (buang "+", spasi, tanda hubung, dll). */
export function normalizeNumber(raw: string): string {
  return raw.replace(/\D+/g, "");
}

export class OwnerAuth {
  private readonly allowed: Set<string>;

  /** @param owners daftar nomor owner/whitelist (format bebas; akan dinormalisasi). */
  constructor(owners: string[]) {
    this.allowed = new Set(
      owners.map((o) => normalizeNumber(o)).filter((d) => d.length > 0),
    );
  }

  /** True bila pengirim termasuk owner/whitelist. */
  isAllowed(from: string): boolean {
    const digits = normalizeNumber(from);
    return digits.length > 0 && this.allowed.has(digits);
  }

  /** Daftar nomor (ter-normalisasi) yang diizinkan — untuk diagnostik. */
  list(): string[] {
    return [...this.allowed];
  }

  get size(): number {
    return this.allowed.size;
  }
}

/** Bangun OwnerAuth dari string env (dipisah koma). */
export function ownerAuthFromEnv(value: string | undefined): OwnerAuth {
  const owners = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new OwnerAuth(owners);
}
