// packages/agents/deployer/src/deployer.agent.ts
// Deployer Agent Implementation
// Orchestrates GitOps deployments, manages canary/blue-green strategies,
// handles auto-rollback on health degradation.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { RollbackEngine, DeploymentState } from './modules/rollback-engine';

// ==================== DATA TYPES ====================

export interface DeployRequest {
  buildId: string;
  artifactUrl: string;
  version: string;
  strategy: 'canary' | 'blue-green' | 'rolling';
  targetEnvironment: 'staging' | 'production';
  healthCheckUrl: string;
}

export interface DeployResult {
  deployId: string;
  status: 'success' | 'rolled_back' | 'failed';
  environment: string;
  deployedVersion: string;
  rollbackTriggered: boolean;
  healthCheckResult: 'pass' | 'fail';
}

// ==================== AGENT CLASS ====================

export class DeployerAgent extends BaseAgent {
  private rollbackEngine: RollbackEngine;

  constructor(config: AgentConfig) {
    // FMEA entries specific to deployment operations
    const deployerFmea: FMEAEntry[] = [
      {
        failure_mode: 'HEALTH_CHECK_TIMEOUT',
        probability: 0.1,
        severity: 'high',
        detection_method: 'No 200 OK from health endpoint > 60s',
        mitigation_strategy: 'Extend timeout, retry health check 3 times',
        fallback_action: 'Trigger immediate rollback'
      },
      {
        failure_mode: 'GITOPS_SYNC_FAILURE',
        probability: 0.05,
        severity: 'critical',
        detection_method: 'ArgoCD/K8s API returns 5xx or OutOfSync',
        mitigation_strategy: 'Verify commit SHA, retry sync',
        fallback_action: 'Abort deployment, alert SRE, preserve previous state'
      }
    ];

    super(config, deployerFmea);

    // Initialize Rollback Engine with config from environment
    this.rollbackEngine = new RollbackEngine({
      apiBaseUrl: process.env.ARGOCD_API_URL || 'http://argocd:443',
      authToken: process.env.ARGOCD_TOKEN || 'mock-token'
    });
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['deployment_orchestration', 'canary_release', 'auto_rollback', 'health_verification'];
  }

  protected async onInit(): Promise<void> {
    this.acp.listenForTasks<DeployRequest, DeployResult>(
      'deploy_artifact',
      this.handleDeployment.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🚀 Deployer Agent [${this.id}] initialized and listening for deployment tasks...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Deployer Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleDeployment(
    payload: DeployRequest,
    message: ACPMessage<DeployRequest>
  ): Promise<DeployResult> {
    const span = this.telemetry.startSpan('deployer.deploy_artifact', message.trace_context);
    span.setAttribute('buildId', payload.buildId);
    span.setAttribute('strategy', payload.strategy);

    let rolledBack = false;
    let deployId = `deploy_${Date.now()}`;

    try {
      console.log(`📦 Deploying ${payload.version} to ${payload.targetEnvironment} via ${payload.strategy}...`);

      // 1. Pre-deployment health check
      const preState = await this.rollbackEngine.checkStatus(`${payload.targetEnvironment}-app`);
      if (preState.healthStatus === 'Degraded') {
        throw new Error('Pre-deployment health check failed. System already degraded.');
      }

      // 2. Execute Deployment (Mock GitOps sync)
      await this.executeGitOpsSync(payload);

      // 3. Post-deployment health verification
      const healthOk = await this.verifyHealth(payload.healthCheckUrl, payload.version);

      if (!healthOk) {
        console.warn(`⚠️ Health check failed for ${payload.version}. Triggering auto-rollback...`);
        rolledBack = true;

        // Trigger Rollback
        const rollbackResult = await this.rollbackEngine.executeRollback(
          `${payload.targetEnvironment}-app`,
          'previous-stable-version'
        );

        const verified = await this.rollbackEngine.verifyPostRollback(
          `${payload.targetEnvironment}-app`,
          'previous-stable-version'
        );

        if (!verified) {
          throw new Error('Rollback verification failed! Manual intervention required.');
        }

        span.setStatus('error', 'Deployment failed, rollback successful');
        return {
          deployId,
          status: 'rolled_back',
          environment: payload.targetEnvironment,
          deployedVersion: payload.version,
          rollbackTriggered: true,
          healthCheckResult: 'fail'
        };
      }

      // 4. Success Path
      await this.audit.commit({
        agent_id: this.id,
        action: 'deployment_successful',
        status: 'success',
         data: { deployId, version: payload.version, environment: payload.targetEnvironment }
      });

      span.setStatus('ok');
      return {
        deployId,
        status: 'success',
        environment: payload.targetEnvironment,
        deployedVersion: payload.version,
        rollbackTriggered: false,
        healthCheckResult: 'pass'
      };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Invoke FMEA
      await this.fmea.handle(err, 'deployer_execution_pipeline');

      throw error;
    } finally {
      span.end();
    }
  }

  private async executeGitOpsSync(payload: DeployRequest): Promise<void> {
    // Mock GitOps sync delay
    console.log(`🔄 Syncing GitOps manifests for version ${payload.version}...`);
    await new Promise(r => setTimeout(r, 3000));
  }

  private async verifyHealth(healthUrl: string, version: string): Promise<boolean> {
    // Simulate health endpoint check with retry logic
    const maxRetries = 3;
    for (let i = 0; i < maxRetries; i++) {
      try {
        // Mock successful health check after first retry
        if (i === 1) return true;
        await new Promise(r => setTimeout(r, 2000));
      } catch {
        // Retry
      }
    }
    return false;
  }
}
