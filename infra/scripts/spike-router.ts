/**
 * Spike 0.3 — 9Router tool/function calling.
 * DoD: kirim prompt + 1 tool def → dapat `tool_calls` valid.
 *
 * Butuh 9Router HIDUP di NINEROUTER_BASE_URL dan minimal satu model terkonfigurasi
 * (NINEROUTER_MODEL_*). Jalankan: `npm run spike:router`.
 */

import type { ToolDefinition } from "@vc/shared";
import { RouterError, createRouterFromEnv } from "@vc/agent-runtime";

const weatherTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Ambil cuaca terkini sebuah kota.",
    parameters: {
      type: "object",
      properties: { city: { type: "string", description: "Nama kota" } },
      required: ["city"],
    },
  },
};

async function main(): Promise<void> {
  const router = createRouterFromEnv();
  console.log("→ Mengirim prompt + 1 tool def ke 9Router…");

  const res = await router.chat({
    messages: [
      { role: "system", content: "Gunakan tool yang tersedia bila relevan." },
      { role: "user", content: "Bagaimana cuaca di Jakarta sekarang? Pakai tool yang ada." },
    ],
    tools: [weatherTool],
    toolChoice: "auto",
  });

  console.log(`✓ model=${res.model} tier=${res.tierUsed} finish=${res.finishReason}`);
  if (res.message.tool_calls && res.message.tool_calls.length > 0) {
    console.log("✓ DoD TERPENUHI — dapat tool_calls:");
    for (const c of res.message.tool_calls) {
      console.log(`   - ${c.function.name}(${c.function.arguments})`);
    }
  } else {
    console.log("⚠ Tidak ada tool_calls. Balasan teks:", res.message.content);
    console.log("  (Model mungkin tidak mendukung function calling, atau memilih tidak memakai tool.)");
  }
}

main().catch((err) => {
  if (err instanceof RouterError) {
    console.error("✗ Router gagal di semua tier:", err.message);
    console.error("  Cek: 9Router hidup di NINEROUTER_BASE_URL? NINEROUTER_MODEL_* terisi?");
  } else {
    console.error("✗ Error:", err);
  }
  process.exitCode = 1;
});
