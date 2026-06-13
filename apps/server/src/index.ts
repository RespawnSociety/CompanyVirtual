/**
 * @vc/server — orchestrator (Phase 0: comms + webhook + auto-reply relay).
 */

export * from "./comms/index.js";
export { makeFrontDeskManager, createAgentReplyHandler } from "./comms/frontDesk.js";
export { buildServer } from "./server.js";
export type { BuildServerDeps } from "./server.js";

// Configuration layer (Phase 1) + runtime persistence (Phase 2)
export { ConfigStore, mysqlConfigFromEnv } from "./db/store.js";
export type {
  MysqlConfig,
  NewCompany,
  NewFloor,
  NewDepartment,
  NewAgent,
  NewDirective,
  NewTask,
  NewArtifact,
  NewWorkflowRun,
  NewApproval,
  NewAuditEntry,
  NewUsageEvent,
} from "./db/store.js";
export { MysqlMemoryStore } from "./db/memoryStore.js";
export { registerConfigRoutes } from "./api/routes.js";
export type { ConfigRoutesOptions } from "./api/routes.js";
export { seedDepartmentFromTemplate, cloneWorkflowDef } from "./config/seed.js";
export type { SeedDepartmentInput, SeededDepartment } from "./config/seed.js";
export { KNOWN_SKILLS, KNOWN_SKILL_NAMES } from "./config/skills.js";
export type { SkillCatalogEntry } from "./config/skills.js";
export { RealtimeHub } from "./realtime.js";

// KPI / pemantauan biaya (Phase 5.4)
export { computeKpi } from "./kpi/kpi.js";
export { recordLoopUsage } from "./kpi/recordUsage.js";
export type { UsageScope } from "./kpi/recordUsage.js";
export { DEFAULT_COST_RATES, costRatesFromEnv } from "./config/costRates.js";

// Runtime registry + dispatch (Phase 2)
export { DirectiveDispatcher } from "./registry/dispatcher.js";
export type {
  DispatcherDeps,
  DispatchResult,
  DispatchOutcome,
} from "./registry/dispatcher.js";

// Workflow engine (Phase 3)
export { WorkflowEngine } from "./workflow/engine.js";
export type {
  WorkflowEngineDeps,
  StartWorkflowResult,
  ApprovalDecision,
} from "./workflow/engine.js";

// Security (Phase 4): Vault, guardrails, auth helper
export {
  FileVault,
  EnvVault,
  LayeredVault,
  NOOP_VAULT,
  createVaultFromEnv,
  envVarNameForKey,
} from "./security/vault.js";
export type { WritableVault, VaultMode } from "./security/vault.js";
export {
  EXTERNAL_POST_ACTIONS,
  RATE_LIMIT_WINDOW_MS,
  checkPostingHours,
  checkRateLimit,
  evaluateGuardrails,
} from "./security/guardrails.js";
export type { GuardrailVerdict, EvaluateContext } from "./security/guardrails.js";
export { hasValidBearer, hasValidSocketToken, safeEqual } from "./security/auth.js";
