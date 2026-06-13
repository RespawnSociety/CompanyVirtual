/**
 * CLI Vault (Phase 4.1) — kelola secret di brankas terenkripsi tanpa menulis di kode/log.
 *
 * Pemakaian (butuh VAULT_MASTER_KEY di .env atau env proses):
 *   npm run vault -- set <key> <value>     # simpan secret (nilai tak di-echo bila via stdin)
 *   npm run vault -- set <key>             # baca nilai dari STDIN (lebih aman, tak masuk shell history)
 *   npm run vault -- has <key>             # cek ada/tidak (tak mencetak nilai)
 *   npm run vault -- del <key>             # hapus
 *   npm run vault -- list                  # daftar KEY (bukan nilai)
 *
 * Contoh: npm run vault -- set instagram.password
 *   (lalu ketik password + Enter; tidak akan tampil di histori shell)
 */

import { FileVault } from "../../apps/server/src/security/vault.js";

function loadEnv(): void {
  const loader = (process as unknown as { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loader === "function") {
    try {
      loader(".env");
    } catch {
      /* .env tak ada — pakai env proses */
    }
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main(): Promise<void> {
  loadEnv();
  const masterKey = process.env.VAULT_MASTER_KEY?.trim();
  const path = process.env.VAULT_PATH?.trim() || "data/vault.enc";
  if (!masterKey) {
    console.error("VAULT_MASTER_KEY belum di-set (.env). Set dulu sebelum mengelola vault.");
    process.exitCode = 1;
    return;
  }

  const [cmd, key, valueArg] = process.argv.slice(2);
  const vault = await FileVault.create(path, masterKey);

  switch (cmd) {
    case "set": {
      if (!key) throw new Error("Pemakaian: vault set <key> [value]");
      const value = valueArg ?? (await readStdin());
      if (!value) throw new Error("Nilai secret kosong.");
      await vault.set(key, value);
      console.log(`✓ tersimpan: ${key} (${value.length} char, terenkripsi di ${path})`);
      break;
    }
    case "has": {
      if (!key) throw new Error("Pemakaian: vault has <key>");
      console.log((await vault.has(key)) ? `ADA: ${key}` : `TIDAK ADA: ${key}`);
      break;
    }
    case "del":
    case "delete": {
      if (!key) throw new Error("Pemakaian: vault del <key>");
      console.log((await vault.delete(key)) ? `✓ dihapus: ${key}` : `tidak ada: ${key}`);
      break;
    }
    case "list": {
      const keys = await vault.keys();
      console.log(keys.length ? keys.join("\n") : "(vault kosong)");
      break;
    }
    default:
      console.error("Perintah: set | has | del | list. Lihat header file untuk contoh.");
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[vault]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
