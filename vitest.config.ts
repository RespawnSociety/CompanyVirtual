import { defineConfig } from "vitest/config";

// Test berjalan terhadap output build tiap package (dist) via package exports.
// Karena itu `pretest` menjalankan `tsc --build` lebih dulu (lihat package.json).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Tes DB memakai satu database MySQL bersama (virtual_company_test) + TRUNCATE antar-test.
    // Jalankan file secara berurutan agar tak saling clobber state DB antar worker paralel.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
