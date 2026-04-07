// packages/agents/notification/src/index.ts
// Entry point for @planner/agent-notification package
export * from './notification.agent';
export * from './modules/channel-manager';

// Factory helper
import { NotificationAgent } from './notification.agent';
import { AgentConfig } from '@planner/core';

export function createNotificationAgent(config: AgentConfig): NotificationAgent {
  return new NotificationAgent(config);
}
