/**
 * Phase 4.1 — Credential Vault (brankas terenkripsi). Membuktikan: round-trip set/get,
 * enkripsi at-rest (file BUKAN plaintext), master key salah gagal dekripsi, EnvVault,
 * LayeredVault (file → env), dan createVaultFromEnv per mode.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileVault,
  EnvVault,
  LayeredVault,
  NOOP_VAULT,
  createVaultFromEnv,
  envVarNameForKey,
} from "@vc/server";

describe("Phase 4.1 — Credential Vault", () => {
  let dir: string;
  let path: string;
  const MASTER = "test-master-passphrase-123";

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vc-vault-"));
    path = join(dir, "vault.enc");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("FileVault: set → get/has, persisten lintas-instance, terenkripsi at-rest", async () => {
    const v = await FileVault.create(path, MASTER);
    expect(await v.has("twitter.password")).toBe(false);
    await v.set("twitter.password", "s3cr3t-token");
    expect(await v.get("twitter.password")).toBe("s3cr3t-token");
    expect(await v.has("twitter.password")).toBe(true);

    // File di disk TIDAK boleh memuat plaintext secret.
    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("s3cr3t-token");

    // Instance baru (master sama) bisa membaca lagi (persisten + dekripsi benar).
    const v2 = await FileVault.create(path, MASTER);
    expect(await v2.get("twitter.password")).toBe("s3cr3t-token");
    expect(await v2.keys()).toContain("twitter.password");
  });

  it("FileVault: delete menghapus secret", async () => {
    const v = await FileVault.create(path, MASTER);
    await v.set("k", "v");
    expect(await v.delete("k")).toBe(true);
    expect(await v.has("k")).toBe(false);
    expect(await v.delete("k")).toBe(false);
  });

  it("FileVault: master key salah → gagal dekripsi (auth tag)", async () => {
    const v = await FileVault.create(path, MASTER);
    await v.set("k", "v");
    await expect(FileVault.create(path, "master-key-LAIN")).rejects.toThrow(/dekripsi|korup|salah/i);
  });

  it("FileVault: master key kosong → error", async () => {
    await expect(FileVault.create(path, "")).rejects.toThrow(/VAULT_MASTER_KEY/);
  });

  it("envVarNameForKey + EnvVault membaca dari environment", async () => {
    expect(envVarNameForKey("twitter.access-token")).toBe("VAULT_TWITTER_ACCESS_TOKEN");
    const env = { VAULT_INSTAGRAM_PASSWORD: "pw123" } as NodeJS.ProcessEnv;
    const v = new EnvVault(env);
    expect(await v.get("instagram.password")).toBe("pw123");
    expect(await v.has("instagram.password")).toBe(true);
    expect(await v.has("instagram.username")).toBe(false);
  });

  it("LayeredVault: primary (file) menang, fallback (env) saat absent", async () => {
    const file = await FileVault.create(path, MASTER);
    await file.set("a", "from-file");
    const env = new EnvVault({ VAULT_A: "from-env", VAULT_B: "env-only" } as NodeJS.ProcessEnv);
    const layered = new LayeredVault(file, env);
    expect(await layered.get("a")).toBe("from-file"); // primary menang
    expect(await layered.get("b")).toBe("env-only"); // fallback
    expect(await layered.has("b")).toBe(true);
  });

  it("createVaultFromEnv: mode noop/env/file", async () => {
    const noop = await createVaultFromEnv({ VAULT_MODE: "noop" } as NodeJS.ProcessEnv);
    expect(noop).toBe(NOOP_VAULT);

    const envOnly = await createVaultFromEnv({
      VAULT_MODE: "env",
      VAULT_X: "y",
    } as NodeJS.ProcessEnv);
    expect(await envOnly.get("x")).toBe("y");

    const fileMode = await createVaultFromEnv({
      VAULT_MODE: "file",
      VAULT_MASTER_KEY: MASTER,
      VAULT_PATH: path,
      VAULT_FALLBACK: "z",
    } as NodeJS.ProcessEnv);
    expect(await fileMode.has("anything")).toBe(false); // file kosong, env tak punya VAULT_ANYTHING
  });
});
