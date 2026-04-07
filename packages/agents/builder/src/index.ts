// packages/agents/builder/src/index.ts
// Entry point for @planner/agent-builder package
export * from './builder.agent';
export * from './modules/ast-validator';

// Factory helper
import { BuilderAgent } from './builder.agent';
import { AgentConfig } from '@planner/core';

export function createBuilderAgent(config: AgentConfig): BuilderAgent {
  return new BuilderAgent(config);
}
