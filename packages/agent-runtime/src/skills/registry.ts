/**
 * Skill Registry — katalog global skill (plan §4). Departemen/agent memilih subset
 * lewat `skillScope`. Engine TIDAK hardcode skill; ia membaca registry ini.
 */

import type { Skill, ToolDefinition } from "@vc/shared";

/**
 * Registry menampung skill dengan tipe I/O heterogen (web_search, write_content, dst),
 * jadi batas tipe ini sengaja longgar. Pemanggil tetap aman: loop hanya memberi
 * Record ke handler dan men-serialize hasilnya.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySkill = Skill<any, any>;

export class SkillRegistry {
  private readonly skills = new Map<string, AnySkill>();

  /** Daftarkan skill. Nama harus unik. */
  register(skill: AnySkill): this {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill duplikat: "${skill.name}"`);
    }
    this.skills.set(skill.name, skill);
    return this;
  }

  /** Daftarkan banyak skill sekaligus. */
  registerAll(skills: AnySkill[]): this {
    for (const s of skills) this.register(s);
    return this;
  }

  get(name: string): AnySkill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): AnySkill[] {
    return [...this.skills.values()];
  }

  /**
   * Bangun tool definitions (format OpenAI) untuk LLM.
   * Bila `scope` diberikan, hanya skill dalam scope yang diekspos
   * (mencegah agent memanggil tool di luar lingkup kerjanya).
   */
  toToolDefinitions(scope?: string[]): ToolDefinition[] {
    const allowed = scope ? new Set(scope) : undefined;
    const out: ToolDefinition[] = [];
    for (const skill of this.skills.values()) {
      if (allowed && !allowed.has(skill.name)) continue;
      out.push({
        type: "function",
        function: {
          name: skill.name,
          description: skill.description,
          parameters: skill.paramsSchema,
        },
      });
    }
    return out;
  }
}
