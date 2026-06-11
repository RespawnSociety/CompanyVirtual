/**
 * @vc/templates — katalog Department Template (data-driven).
 *
 * Engine membaca template sebagai DATA (tidak ada hardcode departemen di engine).
 * Marketing = template #1 (plan §5). Tambah departemen lain = tambah file template
 * di sini lalu daftarkan ke `DEPARTMENT_TEMPLATES`, tanpa menyentuh engine.
 */

import type { DepartmentTemplate, Id } from "@vc/shared";
import { MARKETING_TEMPLATE } from "./marketing.js";

export { MARKETING_TEMPLATE, MARKETING_TEMPLATE_ID } from "./marketing.js";

/** Semua template terdaftar (urutan = urutan tampil di Department Builder). */
export const DEPARTMENT_TEMPLATES: readonly DepartmentTemplate[] = [MARKETING_TEMPLATE];

/** Daftar template untuk UI (ringkas). */
export function listDepartmentTemplates(): readonly DepartmentTemplate[] {
  return DEPARTMENT_TEMPLATES;
}

/** Ambil satu template by id; `undefined` bila tidak ada. */
export function getDepartmentTemplate(id: Id): DepartmentTemplate | undefined {
  return DEPARTMENT_TEMPLATES.find((t) => t.id === id);
}
