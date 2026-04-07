// packages/core/src/acp/registry-http-client.ts
// Production HTTP Client for Central Registry Service
// Replaces in-memory RegistryService in distributed deployments

import { AgentEndpoint } from './types';

export class RegistryHttpClient {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:3001') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async register(endpoint: AgentEndpoint): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(endpoint)
    });
    if (!res.ok) throw new Error(`Registry registration failed: ${res.status} ${res.statusText}`);
  }

  async heartbeat(agentId: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/v1/heartbeat/${agentId}`, { method: 'POST' });
    if (!res.ok) console.warn(`⚠️ Heartbeat failed for ${agentId}: ${res.status}`);
  }

  async discover(agentId: string): Promise<AgentEndpoint | undefined> {
    const res = await fetch(`${this.baseUrl}/api/v1/discover/${agentId}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`Discovery failed: ${res.status}`);
    return res.json();
  }

  async list(capability?: string): Promise<AgentEndpoint[]> {
    const url = capability 
      ? `${this.baseUrl}/api/v1/agents?capability=${encodeURIComponent(capability)}`
      : `${this.baseUrl}/api/v1/agents`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Agent list fetch failed: ${res.status}`);
    const data = await res.json();
    return data.agents || [];
  }

  async deregister(agentId: string): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/deregister/${agentId}`, { method: 'DELETE' });
  }
}
