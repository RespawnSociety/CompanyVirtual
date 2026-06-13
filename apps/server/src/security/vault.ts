/**
 * Credential Vault (Phase 4.1, plan §8) — "brankas terkunci" untuk kredensial (token sosmed,
 * password akun, dll). Implementasi `VaultReader` (`@vc/shared`) + API tulis.
 *
 * Keputusan owner (lihat memory): **encrypted file** AES-256-GCM, master key dari
 * `VAULT_MASTER_KEY` (scrypt-derive 32-byte), file di-gitignore (`data/`). Plus **fallback env**
 * per logical-key untuk dev. Pure-JS (node:crypto), tanpa native build.
 *
 * Aturan keamanan: nilai secret TIDAK PERNAH di-log (hanya key logis & ada/tidaknya). Plaintext
 * hanya ada di memori saat dekripsi; file di disk selalu terenkripsi.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { VaultReader } from "@vc/shared";

/** Vault yang juga bisa menulis (set/delete) selain membaca. */
export interface WritableVault extends VaultReader {
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** Daftar KEY logis yang tersimpan (BUKAN nilainya). Untuk diagnostik/CLI. */
  keys(): Promise<string[]>;
}

const ALGO = "aes-256-gcm";
const SCRYPT_SALT = "virtual-company:vault:v1"; // salt statis app (master key tetap rahasia di env).
const KEY_LEN = 32;
const IV_LEN = 12; // GCM nonce 96-bit (rekomendasi).
const ENVELOPE_VERSION = 1;

interface Envelope {
  v: number;
  iv: string; // base64
  tag: string; // base64
  ct: string; // base64 (ciphertext dari JSON map secret)
}

/** Turunkan kunci 32-byte dari passphrase master (scrypt). */
function deriveKey(masterKey: string): Buffer {
  if (!masterKey || masterKey.trim().length === 0) {
    throw new Error("VAULT_MASTER_KEY kosong — tak bisa membuat FileVault terenkripsi.");
  }
  return scryptSync(masterKey, SCRYPT_SALT, KEY_LEN);
}

function encrypt(key: Buffer, plaintext: string): Envelope {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ct.toString("base64"),
  };
}

function decrypt(key: Buffer, env: Envelope): string {
  const iv = Buffer.from(env.iv, "base64");
  const tag = Buffer.from(env.tag, "base64");
  const ct = Buffer.from(env.ct, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Vault terenkripsi berbasis file. Secret disimpan sebagai map `key → value` yang di-enkripsi
 * utuh (satu envelope) ke `path`. File didekripsi ke memori saat `create()`.
 */
export class FileVault implements WritableVault {
  private constructor(
    private readonly path: string,
    private readonly key: Buffer,
    private readonly secrets: Map<string, string>,
  ) {}

  /** Buat/muat vault dari file. File tak ada → vault kosong (dibuat saat `set` pertama). */
  static async create(path: string, masterKey: string): Promise<FileVault> {
    const key = deriveKey(masterKey);
    const secrets = new Map<string, string>();
    let raw: string | undefined;
    try {
      raw = await readFile(path, "utf8");
    } catch {
      raw = undefined; // file belum ada → vault kosong.
    }
    if (raw && raw.trim().length > 0) {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw) as Envelope;
      } catch {
        throw new Error(`File vault rusak (bukan JSON): ${path}`);
      }
      let plaintext: string;
      try {
        plaintext = decrypt(key, envelope);
      } catch {
        throw new Error(
          `Gagal dekripsi vault ${path} — VAULT_MASTER_KEY salah atau file korup/dimodifikasi.`,
        );
      }
      const map = JSON.parse(plaintext) as Record<string, string>;
      for (const [k, v] of Object.entries(map)) secrets.set(k, v);
    }
    return new FileVault(path, key, secrets);
  }

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.secrets.get(key));
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.secrets.has(key));
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.secrets.keys()].sort());
  }

  async set(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
    await this.persist();
  }

  async delete(key: string): Promise<boolean> {
    const existed = this.secrets.delete(key);
    if (existed) await this.persist();
    return existed;
  }

  private async persist(): Promise<void> {
    const map: Record<string, string> = {};
    for (const [k, v] of this.secrets) map[k] = v;
    const envelope = encrypt(this.key, JSON.stringify(map));
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(envelope), { encoding: "utf8", mode: 0o600 });
  }
}

/** Ubah key logis (mis. `twitter.password`) → nama env var (`VAULT_TWITTER_PASSWORD`). */
export function envVarNameForKey(key: string): string {
  return `VAULT_${key.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase()}`;
}

/** Vault read-only dari environment (dev): logical key → env var `VAULT_<KEY>`. */
export class EnvVault implements VaultReader {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  get(key: string): Promise<string | undefined> {
    const v = this.env[envVarNameForKey(key)];
    return Promise.resolve(v && v.length > 0 ? v : undefined);
  }

  has(key: string): Promise<boolean> {
    const v = this.env[envVarNameForKey(key)];
    return Promise.resolve(!!v && v.length > 0);
  }
}

/** Vault yang mencoba `primary` dulu lalu `fallback` (file → env). */
export class LayeredVault implements VaultReader {
  constructor(
    private readonly primary: VaultReader,
    private readonly fallback: VaultReader,
  ) {}

  async get(key: string): Promise<string | undefined> {
    const v = await this.primary.get(key);
    return v !== undefined ? v : this.fallback.get(key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.primary.has(key)) || this.fallback.has(key);
  }
}

/** Vault kosong (no secrets) — dipakai bila `VAULT_MODE=noop`. */
export const NOOP_VAULT: VaultReader = {
  get: () => Promise.resolve(undefined),
  has: () => Promise.resolve(false),
};

export type VaultMode = "file" | "env" | "noop";

/**
 * Bangun VaultReader dari env (Phase 4):
 * - `VAULT_MODE=file` (default): FileVault (butuh `VAULT_MASTER_KEY`) berlapis EnvVault fallback.
 *   Tanpa master key → turun ke env-only + warning (server tetap start untuk dev).
 * - `VAULT_MODE=env`: EnvVault saja.
 * - `VAULT_MODE=noop`: vault kosong.
 */
export async function createVaultFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VaultReader> {
  const mode = (env.VAULT_MODE?.trim().toLowerCase() || "file") as VaultMode;
  if (mode === "noop") return NOOP_VAULT;
  if (mode === "env") return new EnvVault(env);

  // mode === "file"
  const masterKey = env.VAULT_MASTER_KEY?.trim();
  const path = env.VAULT_PATH?.trim() || "data/vault.enc";
  if (!masterKey) {
    console.warn(
      "[vault] VAULT_MODE=file tapi VAULT_MASTER_KEY kosong — pakai EnvVault (env-only). " +
        "Set VAULT_MASTER_KEY untuk mengaktifkan brankas terenkripsi.",
    );
    return new EnvVault(env);
  }
  const file = await FileVault.create(path, masterKey);
  return new LayeredVault(file, new EnvVault(env));
}
