// packages/agents/deployer/src/index.ts
// Entry point for @planner/agent-deployer package
export * from './deployer.agent';
export * from './modules/rollback-engine';

// Factory helper
import { DeployerAgent } from './deployer.agent';
import { AgentConfig } from '@planner/core';

export function createDeployerAgent(config: AgentConfig): DeployerAgent {
  return new DeployerAgent(config);
}
