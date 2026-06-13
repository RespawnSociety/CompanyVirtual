import { defineConfig } from "vitest/config";

// Test berjalan terhadap output build tiap package (dist) via package exports.
// Karena itu `pretest` menjalankan `tsc --build` lebih dulu (lihat package.json).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Tes DB: tiap FILE test memakai DATABASE-nya sendiri (`virtual_company_test_<file>`),
    // lihat tests/helpers/mysql.ts. Ini menghilangkan flakiness lintas-file: task latar / teardown
    // sebuah file tak bisa men-TRUNCATE atau menulis data file lain (dulu satu DB bersama →
    // "Floor/Department tidak ditemukan" di tengah test secara acak). File tetap berurutan agar
    // koneksi MySQL tak melonjak.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
