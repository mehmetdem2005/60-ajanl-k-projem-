// packages/agents/incident-responder/src/index.ts
// Entry point for @planner/agent-incident-responder package
export * from './incident-responder.agent';
export * from './modules/runbook-executor';

// Factory helper
import { IncidentResponderAgent } from './incident-responder.agent';
import { AgentConfig } from '@planner/core';

export function createIncidentResponderAgent(config: AgentConfig): IncidentResponderAgent {
  return new IncidentResponderAgent(config);
}
