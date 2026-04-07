// packages/agents/builder/src/builder.agent.ts
// Builder Agent Implementation
// Generates code, validates structure, runs security checks, and commits to repository.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { ASTValidator, ValidationResult } from './modules/ast-validator';

// ==================== DATA TYPES ====================

export interface BuildRequest {
  planId: string;
  techStack: any;
  architecture: any;
  repositoryUrl?: string;
}

export interface BuildResult {
  buildId: string;
  status: 'success' | 'failed' | 'security_blocked';
  repositoryUrl: string;
  commitHash: string;
  validationReport: ValidationResult;
  artifactCount: number;
}

// ==================== AGENT CLASS ====================

export class BuilderAgent extends BaseAgent {
  private astValidator: ASTValidator;

  constructor(config: AgentConfig) {
    // FMEA entries specific to code generation & repo operations
    const builderFmea: FMEAEntry[] = [
      {
        failure_mode: 'AST_VALIDATION_FAIL',
        probability: 0.15,
        severity: 'high',
        detection_method: 'Static analysis',
        mitigation_strategy: 'Regenerate code with stricter schema',
        fallback_action: 'Use deterministic template fallback'
      },
      {
        failure_mode: 'GIT_PUSH_FAIL',
        probability: 0.1,
        severity: 'medium',
        detection_method: 'Git CLI/HTTP error',
        mitigation_strategy: 'Retry with exponential backoff + token refresh',
        fallback_action: 'Store artifacts in S3 staging bucket'
      }
    ];

    super(config, builderFmea);
    this.astValidator = new ASTValidator();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['code_generation', 'infrastructure_as_code', 'static_validation', 'repository_management'];
  }

  protected async onInit(): Promise<void> {
    // Register task listener on ACP bus
    this.acp.listenForTasks<BuildRequest, BuildResult>(
      'build_project',
      this.handleBuild.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🏗️ Builder Agent [${this.id}] initialized and listening for build tasks...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Builder Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleBuild(
    payload: BuildRequest,
    message: ACPMessage<BuildRequest>
  ): Promise<BuildResult> {
    const span = this.telemetry.startSpan('builder.build_project', message.trace_context);
    span.setAttribute('planId', payload.planId);

    try {
      console.log(`🔨 Build request received for plan: ${payload.planId}`);

      // 1. Generate Code (Placeholder for LLM/Template engine)
      const generatedCode = await this.generateCode(payload);

      // 2. AST Validation (Structural Integrity Check)
      const validation = this.astValidator.validateStructure(generatedCode, {
        hasAuth: true,
        hasDB: true
      });

      if (!validation.valid) {
        console.warn('⚠️ AST Validation failed:', validation.errors);
        await this.audit.commit({
          agent_id: this.id,
          action: 'validation_failed',
          status: 'failure',
           data: { errors: validation.errors }
        });
        // In production: trigger retry loop or fallback generator
      }

      // 3. Mock Commit & Artifact Generation
      const buildId = `build_${Date.now()}`;
      const result: BuildResult = {
        buildId,
        status: validation.valid ? 'success' : 'failed',
        repositoryUrl: payload.repositoryUrl || `https://github.com/planner/${buildId}`,
        commitHash: `sha256_${Math.random().toString(36).substr(2, 10)}`,
        validationReport: validation,
        artifactCount: 12
      };

      // 4. Audit Completion
      await this.audit.commit({
        agent_id: this.id,
        action: 'build_completed',
        status: 'success',
         data: { buildId, status: result.status }
      });

      span.setStatus('ok');
      return result;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Invoke FMEA handler
      await this.fmea.handle(err, 'builder_build_pipeline');

      throw error;
    } finally {
      span.end();
    }
  }

  private async generateCode(payload: BuildRequest): Promise<string> {
    // Simulates code generation. In production, this calls LLM + deterministic templates.
    return `
      import { auth } from './auth';
      import { db } from './db';

      export class App {
        constructor() {
          console.log('App initialized with ${payload.techStack.language}');
        }
      }
    `;
  }
}
