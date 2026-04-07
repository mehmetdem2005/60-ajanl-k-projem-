// packages/core/src/base-agent.ts
// Base Agent Abstract Class Implementation
// Central composition point for all core capabilities: Telemetry, Audit, FMEA, ACP, Registry.
// Enforces lifecycle contracts and health reporting standards.

import { AgentConfig, AgentIdentity, HealthCheckResult, HealthStatus, FMEAEntry } from './types';
import { TelemetryMixin } from './mixins/telemetry.mixin';
import { AuditMixin } from './mixins/audit.mixin';
import { FMEAMixin } from './mixins/fmea.mixin';
import { ACPAdapter, ACPAdapterConfig } from './acp/adapter';
import { RegistryHttpClient } from './acp/registry-http-client';


  public readonly id: string;
  public readonly config: AgentConfig;
  public readonly identity: AgentIdentity;

  // Core Capabilities (Composition Pattern)
  public readonly telemetry: TelemetryMixin;
  public readonly audit: AuditMixin;
  public readonly fmea: FMEAMixin;
  public readonly acp: ACPAdapter;
  public readonly registry: RegistryHttpClient;

  // Internal State
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private startTime: number;
  private status: HealthStatus = 'unknown';

  constructor(config: AgentConfig, customFmeaTable: FMEAEntry[] = []) {
    this.config = config;
    this.identity = config.identity;
    this.id = config.identity.agent_id;
    this.startTime = Date.now();

    // 1. Initialize Telemetry
    this.telemetry = new TelemetryMixin({
      service_name: this.id,
      sampling_rate: 1.0,
      enable_metrics: true,
      enable_traces: true,
      ...config.telemetry
    });

    // 2. Initialize Audit
    this.audit = new AuditMixin({
      storage_driver: 'memory', // Upgrade to 'postgres'/'s3' in production config
      encryption_enabled: true,
      retention_days: 90,
      worm_mode: true,
      ...config.audit
    });

    // 3. Initialize FMEA & Resilience
    this.fmea = new FMEAMixin(
      config.resilience || {},
      customFmeaTable
    );

    // 4. Initialize Registry (Service Discovery)
    // Note: In production, use HTTP client for central registry
    this.registry = new RegistryHttpClient(
      config.env?.REGISTRY_URL || process.env.REGISTRY_URL || 'http://localhost:3001'
    );

    // 5. Initialize ACP Adapter (Communication)
    const acpConfig: ACPAdapterConfig = {
      identity: this.identity,
      telemetry: this.telemetry,
      defaultTimeoutMs: 30000,
      ...config.acp
    };
    this.acp = new ACPAdapter(acpConfig);
  }

  // ==================== LIFECYCLE ====================

  /**
   * Starts the agent. Handles registration, heartbeat initialization, and domain setup.
   */
  async start(port?: number): Promise<void> {
    const span = this.telemetry.startSpan('agent.lifecycle.start');
    try {
      this.status = 'starting';
      await this.audit.commit({
        agent_id: this.id,
        action: 'agent_starting',
        status: 'success',
        data: { version: this.identity.version }
      });

      // Register with Service Discovery
      this.registry.register({
        agent_id: this.id,
        version: this.identity.version,
        host: 'localhost', // Replace with dynamic host discovery in production
        port: port || 0,
        protocol: 'nats',
        capabilities: await this.getCapabilities(),
        last_heartbeat: Date.now(),
        status: 'online'
      });

      // Start Background Heartbeat
      this.startHeartbeat();

      // Execute agent-specific initialization logic
      await this.onInit();

      this.status = 'healthy';
      span.setStatus('ok');
      console.log(`✅ Agent ${this.id} started successfully.`);
    } catch (error) {
      this.status = 'unhealthy';
      span.setStatus('error', error instanceof Error ? error.message : 'Start failed');
      this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Gracefully stops the agent. Cleans up resources, stops heartbeats, and deregisters.
   */
  async stop(): Promise<void> {
    const span = this.telemetry.startSpan('agent.lifecycle.stop');
    try {
      this.status = 'stopping';
      await this.audit.commit({
        agent_id: this.id,
        action: 'agent_stopping',
        status: 'success',
        data: {}
      });

      // Stop Heartbeat
      this.stopHeartbeat();

      // Execute agent-specific cleanup logic
      await this.onStop();

      // Dispose Communication Layer
      await this.acp.dispose();

      // Deregister from Service Discovery
      this.registry.deregister(this.id);

      this.status = 'offline';
      span.setStatus('ok');
      console.log(`🛑 Agent ${this.id} stopped gracefully.`);
    } catch (error) {
      span.setStatus('error', error instanceof Error ? error.message : 'Stop failed');
      this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  }

  // ==================== HEALTH & STATUS ====================

  /**
   * Returns the current health status of the agent.
   * Used by load balancers, orchestrators, and CLI health checks.
   */
  async getHealth(): Promise<HealthCheckResult> {
    return {
      agent_id: this.id,
      status: this.status,
      uptime_ms: Date.now() - this.startTime,
      version: this.identity.version,
      checks: {
        audit_chain_valid: { status: await this.audit.verifyChain() ? 'pass' : 'fail' },
        acp_ready: { status: 'pass' },
        heartbeat_active: { status: this.heartbeatInterval ? 'pass' : 'warn' }
      },
      timestamp: Date.now()
    };
  }

  // ==================== HEARTBEAT MECHANISM ====================

  private startHeartbeat(): void {
    // Emit heartbeat to registry every 5 seconds
    this.heartbeatInterval = setInterval(async () => {
      try {
        this.registry.heartbeat(this.id);
      } catch (error) {
        // Non-fatal, but log warning for observability
        console.warn(`[BaseAgent] Heartbeat sync failed for ${this.id}:`, error);
      }
    }, 5000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  // ==================== ABSTRACT CONTRACTS ====================

  /**
   * Returns the list of capabilities/skills this agent provides.
   * Used by the Orchestrator for dynamic task routing.
   */
  protected abstract getCapabilities(): Promise<string[]> | string[];

  /**
   * Called during agent startup. Override for domain-specific initialization.
   * (e.g., connecting to external APIs, loading models, validating configs)
   */
  protected abstract onInit(): Promise<void> | void;

  /**
   * Called during agent shutdown. Override for domain-specific cleanup.
   * (e.g., closing DB connections, flushing caches, saving state)
   */
  protected abstract onStop(): Promise<void> | void;
}
