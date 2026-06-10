/**
 * @vc/server — orchestrator (Phase 0: comms + webhook + auto-reply relay).
 */

export * from "./comms/index.js";
export { makeFrontDeskManager, createAgentReplyHandler } from "./comms/frontDesk.js";
export { buildServer } from "./server.js";
export type { BuildServerDeps } from "./server.js";
