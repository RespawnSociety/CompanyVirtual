/**
 * @vc/server — orchestrator (Phase 0: comms + webhook + auto-reply relay).
 */

export * from "./comms/index.js";
export { makeFrontDeskManager, createAgentReplyHandler } from "./comms/frontDesk.js";
export { buildServer } from "./server.js";
export type { BuildServerDeps } from "./server.js";

// Configuration layer (Phase 1)
export { ConfigStore } from "./db/store.js";
export type {
  NewCompany,
  NewFloor,
  NewDepartment,
  NewAgent,
} from "./db/store.js";
export { registerConfigRoutes } from "./api/routes.js";
export type { ConfigRoutesOptions } from "./api/routes.js";
export { seedDepartmentFromTemplate, cloneWorkflowDef } from "./config/seed.js";
export type { SeedDepartmentInput, SeededDepartment } from "./config/seed.js";
export { KNOWN_SKILLS, KNOWN_SKILL_NAMES } from "./config/skills.js";
export type { SkillCatalogEntry } from "./config/skills.js";
export { RealtimeHub } from "./realtime.js";
