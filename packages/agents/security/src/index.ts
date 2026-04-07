// packages/agents/security/src/index.ts
// Entry point for @planner/agent-security package
export * from './security-scanner.agent';
export * from './modules/cve-correlator';

// Factory helper
import { SecurityScannerAgent } from './security-scanner.agent';
import { AgentConfig } from '@planner/core';

export function createSecurityScannerAgent(config: AgentConfig): SecurityScannerAgent {
  return new SecurityScannerAgent(config);
}
