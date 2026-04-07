// packages/core/src/workflow/saga.ts
// Distributed Transaction (Saga) Orchestrator Implementation
// Manages multi-agent workflows, compensations, and failure recovery.
// Integrates with ACPAdapter for inter-agent communication.

import { ACPAdapter } from '../acp/adapter';

import { IStateAdapter, MemoryAdapter } from '../state/adapters';
import { SagaStep, SagaExecution, SagaStepStatus, TelemetryMixin, AuditMixin } from '../types';

  private acp: ACPAdapter;
  private telemetry: TelemetryMixin;
  private audit: AuditMixin;
  private state: IStateAdapter;

  constructor(acp: ACPAdapter, telemetry: TelemetryMixin, audit: AuditMixin, state: IStateAdapter = new MemoryAdapter()) {
    this.acp = acp;
    this.telemetry = telemetry;
    this.audit = audit;
    this.state = state;
  }

  /**
   * Initializes and executes a new Saga workflow.
   * @param sagaId Unique identifier for this execution
   * @param steps Array of steps to execute sequentially
   */
  async execute(sagaId: string, steps: SagaStep[]): Promise<Record<string, any>> {
    const span = this.telemetry.startSpan('saga.execute');
    span.setAttribute('saga_id', sagaId);
    span.setAttribute('step_count', steps.length);

    // Initialize execution state
    const execution: SagaExecution = {
      id: sagaId,
      status: 'running',
      started_at: Date.now(),
      steps: steps.map(s => ({
        name: s.name,
        agent_id: s.agent_id,
        status: 'pending'
      })),
      results: {}
    };
    await this.state.set(`saga:${sagaId}`, execution, 86400); // 1 gün TTL

    try {
      await this.audit.commit({
        agent_id: 'saga-coordinator',
        action: 'saga_started',
        status: 'success',
         { saga_id: sagaId, step_count: steps.length }
      });

      // Execute steps sequentially
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepIndex = i;

        // Update step status to executing
        execution.steps[stepIndex].status = 'executing';
        execution.steps[stepIndex].started_at = Date.now();

        try {
          const stepSpan = this.telemetry.startSpan(`saga.step.${step.name}`);
          stepSpan.setAttribute('agent', step.agent_id);

          // Send task to the target agent
          const result = await this.acp.sendTask(
            step.agent_id,
            step.action,
            step.payload,
            step.timeout_ms
          );

          // Update step status to completed
          execution.steps[stepIndex].status = 'completed';
          execution.steps[stepIndex].completed_at = Date.now();
          execution.results[step.name] = result;

          stepSpan.setStatus('ok');
          stepSpan.end();

          await this.audit.commit({
            agent_id: 'saga-coordinator',
            action: 'saga_step_completed',
            status: 'success',
             { saga_id: sagaId, step_name: step.name, agent: step.agent_id }
          });

        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));

          // Update step status to failed
          execution.steps[stepIndex].status = 'failed';
          execution.steps[stepIndex].completed_at = Date.now();
          execution.steps[stepIndex].error = err.message;

          // Trigger Compensation
          console.warn(`⚠️ Step "${step.name}" failed in Saga "${sagaId}". Initiating compensation...`);
          await this.compensate(sagaId, steps, stepIndex, err);

          // Re-throw to mark saga as failed
          throw error;
        }
      }

      // If all steps succeeded
      execution.status = 'completed';
      execution.completed_at = Date.now();
      span.setStatus('ok');
      await this.audit.commit({
        agent_id: 'saga-coordinator',
        action: 'saga_completed',
        status: 'success',
         { saga_id: sagaId }
      });

      return execution.results;

    } catch (error) {
      execution.status = 'failed';
      execution.completed_at = Date.now();
      span.setStatus('error', error instanceof Error ? error.message : 'Saga failed');
      this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
      // Note: In production, we might keep completed sagas in memory/DB for a while for debugging
    }
  }

  /**
   * Executes compensation steps in reverse order for failed or previously completed steps.
   */
  private async compensate(
    sagaId: string,
    steps: SagaStep[],
    failedStepIndex: number,
    originalError: Error
  ): Promise<void> {
    const execution = await this.state.get<SagaExecution>(`saga:${sagaId}`);
    if (!execution) return;

    execution.status = 'compensating';

    // Iterate backwards from the failed step (exclusive) down to 0
    for (let i = failedStepIndex - 1; i >= 0; i--) {
      const step = steps[i];

      if (step.compensation) {
        console.log(`↩️ Compensating step "${step.name}" in Saga "${sagaId}"...`);
        execution.steps[i].status = 'compensated'; // Tentative status

        try {
          await this.acp.sendTask(
            step.agent_id,
            step.compensation.action,
            step.compensation.payload || step.payload, // Use original payload if compensation payload is empty
            15000 // Shorter timeout for compensation
          );

          execution.steps[i].status = 'compensated'; // Confirmed status
        } catch (compError) {
          execution.steps[i].status = 'failed'; // Compensation failed
          console.error(`❌ Compensation failed for step "${step.name}":`, compError);
          // In production, this is a critical incident requiring human intervention
        }
      }
    }

    await this.audit.commit({
      agent_id: 'saga-coordinator',
      action: 'saga_compensation_completed',
      status: 'failure',
       { saga_id: sagaId, failed_step: steps[failedStepIndex].name }
    });
  }

  /**
   * Retrieves the current status of a running or completed saga.
   */
  async getStatus(sagaId: string): Promise<SagaExecution | undefined> {
    return await this.state.get<SagaExecution>(`saga:${sagaId}`);
  }
}
