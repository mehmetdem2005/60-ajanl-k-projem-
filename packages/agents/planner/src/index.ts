// packages/agents/planner/src/index.ts
// Entry point for @planner/agent-planner package
export * from './planner.agent';
export * from './modules/constraint-solver';
export * from './modules/tech-selector';

// Factory helper for clean instantiation
import { PlannerAgent } from './planner.agent';
import { AgentConfig } from '@planner/core';

export function createPlannerAgent(config: AgentConfig): PlannerAgent {
  return new PlannerAgent(config);
}
