// packages/agents/monitoring/src/index.ts
// Entry point for @planner/agent-monitoring package
export * from './monitoring.agent';
export * from './modules/metric-analyzer';

// Factory helper
import { MonitoringAgent } from './monitoring.agent';
import { AgentConfig } from '@planner/core';

export function createMonitoringAgent(config: AgentConfig): MonitoringAgent {
  return new MonitoringAgent(config);
}
