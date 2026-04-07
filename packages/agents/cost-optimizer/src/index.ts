// packages/agents/cost-optimizer/src/index.ts
// Entry point for @planner/agent-cost-optimizer package
export * from './cost-optimizer.agent';
export * from './modules/cost-analyzer';

// Factory helper
import { CostOptimizerAgent } from './cost-optimizer.agent';
import { AgentConfig } from '@planner/core';

export function createCostOptimizerAgent(config: AgentConfig): CostOptimizerAgent {
  return new CostOptimizerAgent(config);
}
