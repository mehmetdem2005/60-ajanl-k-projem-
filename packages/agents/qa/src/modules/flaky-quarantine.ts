// packages/agents/qa/src/modules/flaky-quarantine.ts
// Flaky Test Quarantine Module
// Identifies unstable tests using statistical analysis and quarantines them
// to prevent false-positive build failures.

export interface TestResult {
  testId: string;
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  duration_ms: number;
  error?: string;
  retryCount: number;
}

export interface FlakyAnalysis {
  testId: string;
  flakinessScore: number; // 0.0 (stable) to 1.0 (very flaky)
  failurePattern: 'intermittent' | 'environment' | 'timing' | 'unknown';
  recommendation: 'quarantine' | 'fix' | 'ignore' | 'monitor';
}

export class FlakyQuarantine {
  private history: Map<string, TestResult[]> = new Map();
  private readonly FLAKY_THRESHOLD = 0.3; // 30% failure rate = flaky

  /**
   * Records a test result for historical analysis.
   */
  record(testResult: TestResult): void {
    if (!this.history.has(testResult.testId)) {
      this.history.set(testResult.testId, []);
    }
    const history = this.history.get(testResult.testId)!;
    history.push(testResult);

    // Keep last 50 runs for analysis
    if (history.length > 50) {
      history.shift();
    }
  }

  /**
   * Analyzes test history to detect flaky behavior.
   * Uses Bernoulli trial analysis for failure probability.
   */
  analyze(testId: string): FlakyAnalysis | null {
    const history = this.history.get(testId);
    if (!history || history.length < 10) {
      return null; // Not enough data
    }

    const failures = history.filter(r => r.status === 'failed').length;
    const failureRate = failures / history.length;

    // Detect patterns
    let pattern: FlakyAnalysis['failurePattern'] = 'unknown';
    if (failureRate > 0 && failureRate < 0.5) {
      pattern = 'intermittent';
    } else if (history.some(r => r.error?.includes('timeout'))) {
      pattern = 'timing';
    } else if (history.some(r => r.error?.includes('network'))) {
      pattern = 'environment';
    }

    const flakinessScore = failureRate;
    const recommendation = this.getRecommendation(flakinessScore, pattern);

    return {
      testId,
      flakinessScore,
      failurePattern: pattern,
      recommendation
    };
  }

  /**
   * Returns list of tests that should be quarantined.
   */
  getQuarantineList(): string[] {
    const quarantined: string[] = [];

    for (const testId of this.history.keys()) {
      const analysis = this.analyze(testId);
      if (analysis?.recommendation === 'quarantine') {
        quarantined.push(testId);
      }
    }

    return quarantined;
  }

  private getRecommendation(score: number, pattern: string): FlakyAnalysis['recommendation'] {
    if (score >= this.FLAKY_THRESHOLD) {
      if (pattern === 'timing' || pattern === 'environment') {
        return 'fix'; // Fix the test infrastructure
      }
      return 'quarantine'; // Remove from critical path
    }
    if (score > 0.1) {
      return 'monitor'; // Watch but don't block
    }
    return 'ignore'; // Stable test
  }
}
