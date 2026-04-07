// packages/agents/planner/src/planner.agent.ts
// Planner Agent Implementation
// The "Brain" of the ecosystem. Analyzes intent, resolves constraints, selects tech stack, and outputs a Master Plan.
// Extends BaseAgent for standard lifecycle, telemetry, and audit capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { ConstraintSolver, Constraint, SolvedConstraints } from './modules/constraint-solver';
import { TechSelector, TechStack } from './modules/tech-selector';

// ==================== DATA TYPES ====================

// Request expected from User Proxy or CLI
export interface PlanningRequest {
  intent: string;
  constraints: Constraint[];
  metadata?: Record<string, any>;
}

// The output artifact consumed by Builder Agent
export interface MasterPlan {
  id: string;
  intent: string;
  techStack: TechStack;
  architecture: {
    services: string[];
    dataFlow: string;
  };
  costEstimate: number;
  estimatedTimeline: string;
  status: 'draft' | 'approved' | 'executing';
  solvedConstraints: SolvedConstraints;
}

// ==================== AGENT CLASS ====================

export class PlannerAgent extends BaseAgent {
  private solver: ConstraintSolver;
  private selector: TechSelector;

  constructor(config: AgentConfig) {
    // Initialize with specific FMEA entries for Planner failures
    const plannerFmea: FMEAEntry[] = [
      {
        failure_mode: 'ConstraintConflict',
        probability: 0.2,
        severity: 'high',
        detection_method: 'ConstraintSolver analysis',
        mitigation_strategy: 'Adjust priorities',
        fallback_action: 'Return draft with warnings'
      },
      {
        failure_mode: 'LLMTimeout', // If we add AI reasoning later
        probability: 0.1,
        severity: 'medium',
        detection_method: 'Timeout error',
        mitigation_strategy: 'Retry with exponential backoff',
        fallback_action: 'Use rule-based fallback'
      }
    ];

    super(config, plannerFmea);
    this.solver = new ConstraintSolver();
    this.selector = new TechSelector();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return [
      'plan_generation',
      'architecture_design',
      'cost_estimation',
      'constraint_resolution'
    ];
  }

  protected async onInit(): Promise<void> {
    // Register Task Listeners
    // Listens for 'plan_intent' actions from the ACP Bus
    this.acp.listenForTasks<PlanningRequest, MasterPlan>(
      'plan_intent',
      this.handlePlanning.bind(this)
    );

    // Log startup
    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🧠 Planner Agent [${this.id}] initialized and listening for intents...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Planner Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  /**
   * Main business logic: Receives a request and generates a Master Plan.
   * This method is invoked via ACP when a task is received.
   */
  private async handlePlanning(
    payload: PlanningRequest,
    message: ACPMessage<PlanningRequest>
  ): Promise<MasterPlan> {
    const span = this.telemetry.startSpan('planner.plan_creation', message.trace_context);
    span.setAttribute('intent', payload.intent);

    try {
      console.log(`📝 Planning request received: "${payload.intent}"`);

      // 1. Solve Constraints (Conflict Resolution)
      const solvedConstraints = this.solver.resolve(payload.constraints);

      if (solvedConstraints.adjusted) {
        console.warn('⚠️ Constraints were adjusted during resolution.');
        await this.audit.commit({
          agent_id: this.id,
          action: 'constraints_adjusted',
          status: 'warning',
          data: { adjustments: solvedConstraints.adjustments }
        });
      }

      // 2. Select Tech Stack
      const techStack = this.selector.select(solvedConstraints);

      // 3. Construct Master Plan
      // In a real scenario, this would involve deeper reasoning or LLM calls.
      const masterPlan: MasterPlan = {
        id: `plan_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        intent: payload.intent,
        techStack,
        architecture: {
          services: ['api-gateway', 'core-service', 'db-service'],
          dataFlow: 'RESTful API with PostgreSQL persistence'
        },
        costEstimate: this.estimateCost(techStack),
        estimatedTimeline: '4-6 weeks',
        status: 'draft',
        solvedConstraints
      };

      // 4. Audit Completion
      await this.audit.commit({
        agent_id: this.id,
        action: 'plan_generated',
        status: 'success',
        data: { planId: masterPlan.id, techStack: techStack.language }
      });

      span.setStatus('ok');
      return masterPlan;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Use FMEA Mixin to handle error
      await this.fmea.handle(err, 'planner_core_logic');

      throw error;
    } finally {
      span.end();
    }
  }

  // Simple heuristic for cost estimation
  private estimateCost(techStack: TechStack): number {
    let base = 500; // Base monthly cost
    if (techStack.infra.includes('Kubernetes')) base += 200;
    if (techStack.database.includes('Oracle')) base += 500;
    if (techStack.infra.includes('GPU')) base += 1000;
    return base;
  }
}
