/**
 * Helper test untuk MySQL (XAMPP/MariaDB). Tes Phase 2 memakai DATABASE TERPISAH
 * (`virtual_company_test`) agar tidak menyentuh data app. `resetTestDb()` mengosongkan
 * seluruh tabel antar-test (TRUNCATE dengan FK checks dimatikan sementara).
 *
 * Prasyarat: MySQL hidup (mis. XAMPP). Lihat docs/RUNBOOK.md. Tanpa MySQL, tes DB ini gagal
 * (konsekuensi dari keputusan "full switch ke MySQL"); tes non-DB tetap jalan.
 */

import mysql from "mysql2/promise";
import { ConfigStore } from "@vc/server";

const TEST_DB = process.env.DB_MYSQL_TEST_DATABASE?.trim() || "virtual_company_test";

function baseConfig(): { host: string; port: number; user: string; password: string } {
  return {
    host: process.env.DB_MYSQL_HOST?.trim() || "127.0.0.1",
    port: Number(process.env.DB_MYSQL_PORT ?? 3306),
    user: process.env.DB_MYSQL_USER?.trim() || "root",
    password: process.env.DB_MYSQL_PASSWORD ?? "",
  };
}

/** Tabel yang di-TRUNCATE antar-test (urutan bebas karena FK checks dimatikan). */
const TABLES = [
  "audit_entries",
  "approvals",
  "workflow_runs",
  "artifacts",
  "tasks",
  "directives",
  "agents",
  "departments",
  "floors",
  "workflows",
  "companies",
  "comms_messages",
  "memory_items",
] as const;

/** Buat ConfigStore terhadap database test (dibuat bila belum ada) + pastikan skema. */
export async function createTestStore(): Promise<ConfigStore> {
  const cfg = baseConfig();
  const admin = await mysql.createConnection(cfg);
  await admin.query(
    `CREATE DATABASE IF NOT EXISTS \`${TEST_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await admin.end();
  return ConfigStore.create({ ...cfg, database: TEST_DB });
}

/** Kosongkan semua tabel test (panggil di beforeEach). Tabel harus sudah dibuat. */
export async function resetTestDb(): Promise<void> {
  const conn = await mysql.createConnection({ ...baseConfig(), database: TEST_DB });
  try {
    await conn.query("SET FOREIGN_KEY_CHECKS=0");
    for (const t of TABLES) {
      await conn.query(`TRUNCATE TABLE \`${t}\``);
    }
    await conn.query("SET FOREIGN_KEY_CHECKS=1");
  } finally {
    await conn.end();
  }
}
