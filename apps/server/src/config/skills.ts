/**
 * Katalog skill yang dikenal platform (untuk pilihan di Character Editor & Department Builder).
 *
 * Ini DAFTAR NAMA (kontrak skillScope/skillPool), bukan implementasi. Implementasi nyata
 * hidup di `@vc/agent-runtime/skills` dan bertambah bertahap (Phase 2–4). `implemented`
 * menandai mana yang sudah ada handler-nya agar UI bisa memberi tanda.
 */

export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** true bila sudah ada handler di agent-runtime; false = direncanakan (Phase 2–4). */
  implemented: boolean;
  /** true bila aksi berisiko (wajib approval gate). */
  risky: boolean;
}

export const KNOWN_SKILLS: readonly SkillCatalogEntry[] = [
  { name: "web_search", description: "Cari informasi di web.", implemented: true, risky: false },
  { name: "web_fetch", description: "Ambil & baca isi sebuah URL.", implemented: false, risky: false },
  { name: "browser_do", description: "Kendalikan browser untuk riset/aksi.", implemented: false, risky: false },
  { name: "market_research", description: "Riset tren/kompetitor/audiens/keyword.", implemented: false, risky: false },
  { name: "write_content", description: "Tulis konten (caption, script, thread, CTA).", implemented: false, risky: false },
  { name: "review_content", description: "Review kualitas, brand voice, kepatuhan.", implemented: false, risky: false },
  { name: "message_agent", description: "Kirim pesan/delegasi ke agent lain.", implemented: false, risky: false },
  { name: "ask_user", description: "Tanya/klarifikasi ke owner via WhatsApp.", implemented: false, risky: false },
  { name: "ig_post", description: "Publish ke Instagram (approval-gated).", implemented: false, risky: true },
  { name: "twitter_post", description: "Publish ke Twitter/X (approval-gated).", implemented: false, risky: true },
  { name: "schedule_post", description: "Jadwalkan publish konten (approval-gated).", implemented: false, risky: true },
];

/** Set nama skill yang dikenal (untuk validasi skillScope/skillPool). */
export const KNOWN_SKILL_NAMES: ReadonlySet<string> = new Set(KNOWN_SKILLS.map((s) => s.name));
