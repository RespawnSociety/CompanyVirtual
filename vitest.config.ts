import { defineConfig } from "vitest/config";

// Test berjalan terhadap output build tiap package (dist) via package exports.
// Karena itu `pretest` menjalankan `tsc --build` lebih dulu (lihat package.json).
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
