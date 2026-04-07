// packages/agents/incident-responder/src/modules/runbook-executor.ts
// Runbook Execution Engine
// Sequentially executes remediation steps, handles failures, and manages compensation/rollback logic.

export interface RunbookStep {
  id: string;
  name: string;
  action: string; // e.g., 'restart_service', 'scale_up', 'clear_cache'
  target: string;
  params: Record<string, any>;
  timeoutMs: number;
  compensation?: {
    action: string;
    target: string;
    params: Record<string, any>;
  };
}

export interface Runbook {
  id: string;
  name: string;
  triggerCondition: string;
  steps: RunbookStep[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface StepExecutionResult {
  stepId: string;
  status: 'success' | 'failed' | 'compensated';
  output?: string;
  error?: string;
  durationMs: number;
}

export interface RunbookExecutionResult {
  runbookId: string;
  status: 'completed' | 'failed' | 'partial';
  steps: StepExecutionResult[];
  totalDurationMs: number;
}

export class RunbookExecutor {
  /**
   * Executes a runbook step-by-step. Fails fast on error unless configured otherwise.
   * Automatically attempts compensation for failed steps.
   */
  async execute(runbook: Runbook): Promise<RunbookExecutionResult> {
    const startTime = Date.now();
    const executedSteps: StepExecutionResult[] = [];
    let overallStatus: RunbookExecutionResult['status'] = 'completed';

    for (let i = 0; i < runbook.steps.length; i++) {
      const step = runbook.steps[i];
      const stepStart = Date.now();

      try {
        console.log(`🔧 Executing step ${i + 1}/${runbook.steps.length}: ${step.name} on ${step.target}...`);

        // Simulate step execution (Replace with actual ACP call or CLI execution in production)
        await this.executeAction(step.action, step.target, step.params, step.timeoutMs);

        executedSteps.push({
          stepId: step.id,
          status: 'success',
          durationMs: Date.now() - stepStart
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.warn(`⚠️ Step failed: ${step.name}. Attempting compensation...`);

        executedSteps.push({
          stepId: step.id,
          status: 'failed',
          error: err.message,
          durationMs: Date.now() - stepStart
        });

        overallStatus = 'failed';

        // Attempt compensation if defined
        if (step.compensation) {
          try {
            await this.executeAction(step.compensation.action, step.compensation.target, step.compensation.params, 15000);
            // Update last step status to reflect successful compensation
            executedSteps[executedSteps.length - 1].status = 'compensated';
          } catch (compError) {
            console.error(`❌ Compensation failed for step ${step.name}:`, compError);
          }
        }

        // Stop execution on failure (fail-fast strategy)
        break;
      }
    }

    // Mark remaining steps as skipped if execution stopped early
    if (overallStatus === 'failed' && executedSteps.length < runbook.steps.length) {
      for (let i = executedSteps.length; i < runbook.steps.length; i++) {
        executedSteps.push({
          stepId: runbook.steps[i].id,
          status: 'failed', // Or 'skipped' depending on policy
          error: 'Execution aborted due to previous step failure',
          durationMs: 0
        });
      }
    }

    return {
      runbookId: runbook.id,
      status: overallStatus === 'completed' ? 'completed' : (executedSteps.some(s => s.status === 'compensated') ? 'partial' : 'failed'),
      steps: executedSteps,
      totalDurationMs: Date.now() - startTime
    };
  }

  private async executeAction(action: string, target: string, params: Record<string, any>, timeoutMs: number): Promise<void> {
    // Placeholder for actual execution logic (e.g., Kubernetes API, ACP call, Shell script)
    // Simulates network/operation delay
    const delay = Math.min(timeoutMs, 1000);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Mock random failure for demonstration (10% chance)
    if (Math.random() < 0.1) {
      throw new Error(`Action ${action} failed on ${target}: Simulated transient error`);
    }
  }
}
