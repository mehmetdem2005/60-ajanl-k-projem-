// packages/core/src/acp/registry.ts
// Service Discovery & Health Registry Implementation
// Tracks agent availability, versions, capabilities, and heartbeat health.
// Acts as the central directory for A2A communication.

import { AgentEndpoint } from './types';

export class RegistryService {
  // In-memory store for agent endpoints.
  // In production, this would be backed by Redis, Consul, or a Database.
  private agents: Map<string, AgentEndpoint> = new Map();

  // Time in ms before an agent is considered offline if no heartbeat is received.
  private readonly HEARTBEAT_TIMEOUT_MS: number = 30000; // 30 seconds

  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup of dead agents
    this.startCleanupInterval();
  }

  /**
   * Registers or updates an agent endpoint.
   * Resets the heartbeat to "now" and sets status to "online".
   */
  register(endpoint: AgentEndpoint): void {
    const now = Date.now();

    // Preserve existing registration data if we are just refreshing heartbeat/capabilities
    // but overwrite critical network details provided in the new payload.
    this.agents.set(endpoint.agent_id, {
      ...endpoint,
      last_heartbeat: now,
      status: 'online'
    });
  }

  /**
   * Updates the heartbeat timestamp for an agent.
   * Used by agents to prove they are still alive and active.
   */
  heartbeat(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.last_heartbeat = Date.now();
      agent.status = 'online';
      this.agents.set(agentId, agent);
    }
  }

  /**
   * Retrieves the endpoint info for a specific agent.
   * Checks health status before returning.
   * Returns undefined if agent is not found or considered offline.
   */
  discover(agentId: string): AgentEndpoint | undefined {
    const agent = this.agents.get(agentId);
    if (!agent) return undefined;

    // Check if agent is actually alive based on heartbeat
    const timeSinceLastBeat = Date.now() - agent.last_heartbeat;
    if (timeSinceLastBeat > this.HEARTBEAT_TIMEOUT_MS) {
      agent.status = 'offline'; // Mark as offline in memory
      return undefined; // Treat as not discovered
    }

    return agent;
  }

  /**
   * Returns a list of all healthy, online agents.
   * Optionally filters by capability (e.g., 'security-scanning', 'deployment').
   */
  list(capabilityFilter?: string): AgentEndpoint[] {
    const now = Date.now();
    const activeAgents: AgentEndpoint[] = [];

    for (const [, agent] of this.agents.entries()) {
      const timeSinceLastBeat = now - agent.last_heartbeat;

      // If heartbeat is old, mark offline and skip
      if (timeSinceLastBeat > this.HEARTBEAT_TIMEOUT_MS) {
        agent.status = 'offline';
        continue;
      }

      // Filter by capability if requested
      if (capabilityFilter) {
        if (agent.capabilities && agent.capabilities.includes(capabilityFilter)) {
          activeAgents.push(agent);
        }
      } else {
        activeAgents.push(agent);
      }
    }

    return activeAgents;
  }

  /**
   * Deregisters an agent (e.g., during graceful shutdown).
   */
  deregister(agentId: string): void {
    this.agents.delete(agentId);
  }

  // ==================== INTERNAL HELPERS ====================

  /**
   * Starts a background loop to check for dead agents.
   */
  private startCleanupInterval(): void {
    // Run cleanup every 10 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, agent] of this.agents.entries()) {
        if (now - agent.last_heartbeat > this.HEARTBEAT_TIMEOUT_MS) {
          agent.status = 'offline';
          // In a persistent registry, this is where you might delete the record
          // after a grace period. Here we keep it for debugging but mark offline.
        }
      }
    }, 10000);
  }

  /**
   * Gracefully stops the cleanup interval.
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
