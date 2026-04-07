// packages/agents/qa/src/index.ts
// Entry point for @planner/agent-qa package
export * from './qa.agent';
export * from './modules/flaky-quarantine';

// Factory helper
import { QAAgent } from './qa.agent';
import { AgentConfig } from '@planner/core';

export function createQAAgent(config: AgentConfig): QAAgent {
  return new QAAgent(config);
}
