// packages/agents/monitoring/src/modules/metric-analyzer.ts
// Metric Analyzer Module
// Statistical analysis engine for real-time metrics.
// Uses Z-Score and moving averages to detect anomalies & SLO violations.

export interface MetricPoint {
  metricName: string;
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

export interface SLOConfig {
  metricName: string;
  threshold: number;
  comparison: 'lt' | 'gt' | 'eq';
  windowMs: number; // Evaluation window
  severity: 'info' | 'warning' | 'critical';
}

export interface AnomalyResult {
  metricName: string;
  currentValue: number;
  expectedValue: number;
  zScore: number;
  isAnomaly: boolean;
  timestamp: number;
}

export class MetricAnalyzer {
  private history: Map<string, number[]> = new Map();
  private readonly WINDOW_SIZE = 50; // Keep last 50 data points for statistical window

  /**
   * Ingests a metric point and updates statistical history.
   */
  ingest(point: MetricPoint): void {
    const key = this.getKey(point);
    if (!this.history.has(key)) {
      this.history.set(key, []);
    }
    const data = this.history.get(key)!;
    data.push(point.value);

    // Maintain fixed window size
    if (data.length > this.WINDOW_SIZE) {
      data.shift();
    }
  }

  /**
   * Evaluates a metric against SLO thresholds.
   */
  evaluateSLO(point: MetricPoint, slo: SLOConfig): boolean {
    const passes = this.checkThreshold(point.value, slo.threshold, slo.comparison);
    return passes;
  }

  /**
   * Detects statistical anomalies using Z-Score method.
   * Z-Score > 2.0 or < -2.0 indicates statistically significant deviation.
   */
  detectAnomaly(point: MetricPoint): AnomalyResult | null {
    const key = this.getKey(point);
    const data = this.history.get(key);
    if (!data || data.length < 10) return null; // Not enough data for statistical significance

    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    const variance = data.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return null; // No variance

    const zScore = (point.value - mean) / stdDev;

    return {
      metricName: key,
      currentValue: point.value,
      expectedValue: mean,
      zScore,
      isAnomaly: Math.abs(zScore) > 2.0,
      timestamp: Date.now()
    };
  }

  // ==================== PRIVATE HELPERS ====================
  private getKey(point: MetricPoint): string {
    const labelStr = point.labels ? JSON.stringify(Object.entries(point.labels).sort()) : '{}';
    return `${point.metricName}:${labelStr}`;
  }

  private checkThreshold(current: number, threshold: number, op: SLOConfig['comparison']): boolean {
    switch (op) {
      case 'lt': return current < threshold;
      case 'gt': return current > threshold;
      case 'eq': return current === threshold;
      default: return true;
    }
  }
}
