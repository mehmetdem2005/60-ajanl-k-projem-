// packages/agents/qa/src/qa.agent.ts
// QA Agent Implementation
// Orchestrates test execution, analyzes flakiness, reports coverage,
// and enforces quality gates.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { FlakyQuarantine, TestResult, FlakyAnalysis } from './modules/flaky-quarantine';

// ==================== DATA TYPES ====================

export interface TestRequest {
  buildId: string;
  testSuite: 'unit' | 'integration' | 'e2e' | 'all';
  coverageThreshold: number; // e.g., 80 for 80%
  quarantineFlaky: boolean;
}

export interface TestReport {
  reportId: string;
  buildId: string;
  status: 'pass' | 'fail' | 'warning';
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  flakyDetected: number;
  coverage: number;
  quarantinedTests: string[];
  recommendations: string[];
}

// ==================== AGENT CLASS ====================

export class QAAgent extends BaseAgent {
  private flakyQuarantine: FlakyQuarantine;

  constructor(config: AgentConfig) {
    // FMEA entries specific to test execution
    const qaFmea: FMEAEntry[] = [
      {
        failure_mode: 'TEST_RUNNER_TIMEOUT',
        probability: 0.12,
        severity: 'medium',
        detection_method: 'No output for > 5min',
        mitigation_strategy: 'Kill runner, retry with reduced parallelism',
        fallback_action: 'Run critical tests only, skip non-critical'
      },
      {
        failure_mode: 'FLAKY_TEST_FALSE_POSITIVE',
        probability: 0.2,
        severity: 'high',
        detection_method: 'Test passes on retry',
        mitigation_strategy: 'Auto-quarantine flaky tests',
        fallback_action: 'Mark as warning, allow build to proceed'
      }
    ];

    super(config, qaFmea);
    this.flakyQuarantine = new FlakyQuarantine();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['test_execution', 'flaky_detection', 'coverage_analysis', 'quality_gating'];
  }

  protected async onInit(): Promise<void> {
    this.acp.listenForTasks<TestRequest, TestReport>(
      'run_tests',
      this.handleTestRun.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🧪 QA Agent [${this.id}] initialized and listening for test tasks...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 QA Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleTestRun(
    payload: TestRequest,
    message: ACPMessage<TestRequest>
  ): Promise<TestReport> {
    const span = this.telemetry.startSpan('qa.run_tests', message.trace_context);
    span.setAttribute('buildId', payload.buildId);
    span.setAttribute('suite', payload.testSuite);

    try {
      console.log(`🔬 Running ${payload.testSuite} tests for build ${payload.buildId}...`);

      // 1. Execute Tests (Mock execution)
      const testResults = await this.executeTests(payload);

      // 2. Record results for flaky analysis
      for (const result of testResults) {
        this.flakyQuarantine.record(result);
      }

      // 3. Analyze flakiness & quarantine if requested
      let quarantinedTests: string[] = [];
      if (payload.quarantineFlaky) {
        quarantinedTests = this.flakyQuarantine.getQuarantineList();
        console.log(`📦 Quarantined ${quarantinedTests.length} flaky tests`);
      }

      // 4. Calculate metrics
      const passed = testResults.filter(r => r.status === 'passed').length;
      const failed = testResults.filter(r => r.status === 'failed' && !quarantinedTests.includes(r.testId)).length;
      const flakyDetected = quarantinedTests.length;

      // Mock coverage calculation
      const coverage = 85.2; // In production, parse coverage report

      // 5. Determine status
      let status: 'pass' | 'fail' | 'warning' = 'pass';
      if (failed > 0) {
        status = 'fail';
      } else if (flakyDetected > 0 || coverage < payload.coverageThreshold) {
        status = 'warning';
      }

      // 6. Generate recommendations
      const recommendations: string[] = [];
      if (flakyDetected > 0) {
        recommendations.push(`Review ${flakyDetected} quarantined tests for stability fixes`);
      }
      if (coverage < payload.coverageThreshold) {
        recommendations.push(`Increase test coverage from ${coverage}% to ${payload.coverageThreshold}%`);
      }
      if (failed > 0) {
        recommendations.push(`Fix ${failed} failing tests before deployment`);
      }

      // 7. Generate Report
      const report: TestReport = {
        reportId: `qa_${Date.now()}`,
        buildId: payload.buildId,
        status,
        totalTests: testResults.length,
        passed,
        failed,
        skipped: testResults.filter(r => r.status === 'skipped').length,
        flakyDetected,
        coverage,
        quarantinedTests,
        recommendations
      };

      // 8. Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'test_run_completed',
        status: status === 'pass' ? 'success' : 'failure',
         data: { reportId: report.reportId, status, coverage }
      });

      span.setStatus('ok');
      return report;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Invoke FMEA
      await this.fmea.handle(err, 'qa_test_execution');

      throw error;
    } finally {
      span.end();
    }
  }

  private async executeTests(payload: TestRequest): Promise<TestResult[]> {
    // Mock test execution - in production, this runs Playwright/Jest/etc.
    const mockTests = [
      { testId: 'auth_login', name: 'User login flow', status: 'passed' as const, duration_ms: 234 },
      { testId: 'api_create', name: 'Create resource API', status: 'passed' as const, duration_ms: 156 },
      { testId: 'db_migration', name: 'Database migration test', status: 'failed' as const, duration_ms: 890, error: 'Connection timeout' },
      { testId: 'ui_render', name: 'Homepage render', status: 'passed' as const, duration_ms: 445 }
    ];

    return mockTests as TestResult[];
  }
}
