// packages/agents/monitoring/src/monitoring.agent.ts
// Monitoring Agent Implementation
// Collects metrics, evaluates SLOs, detects statistical anomalies,
// and triggers alerts via ACP when thresholds are breached.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { MetricAnalyzer, MetricPoint, SLOConfig, AnomalyResult } from './modules/metric-analyzer';

// ==================== DATA TYPES ====================

export interface MetricIngestionRequest {
  metrics: MetricPoint[];
  sloConfigs: SLOConfig[];
}

export interface MonitoringReport {
  reportId: string;
  status: 'healthy' | 'degraded' | 'critical';
  anomaliesDetected: number;
    sloViolations: SLOViolation[];
  timestamp: number;
}

interface SLOViolation {
  metricName: string;
  threshold: number;
  actualValue: number;
  severity: string;
}

// ==================== AGENT CLASS ====================

export class MonitoringAgent extends BaseAgent {
  private analyzer: MetricAnalyzer;

  constructor(config: AgentConfig) {
    // FMEA entries specific to monitoring operations
    const monitoringFmea: FMEAEntry[] = [
      {
        failure_mode: 'METRIC_INGESTION_BACKPRESSURE',
        probability: 0.15,
        severity: 'medium',
        detection_method: 'Queue depth > 10k metrics',
        mitigation_strategy: 'Enable metric sampling, drop lowest priority labels',
        fallback_action: 'Switch to aggregated metric ingestion mode'
      },
      {
        failure_mode: 'FALSE_POSITIVE_ALERT',
        probability: 0.1,
        severity: 'high',
        detection_method: 'Alert resolved within < 2 minutes',
        mitigation_strategy: 'Increase Z-Score threshold, add hysteresis',
        fallback_action: 'Suppress alert, log for model retraining'
      }
    ];

    super(config, monitoringFmea);
    this.analyzer = new MetricAnalyzer();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['metric_ingestion', 'slo_evaluation', 'anomaly_detection', 'alert_routing'];
  }

  protected async onInit(): Promise<void> {
    this.acp.listenForTasks<MetricIngestionRequest, MonitoringReport>(
      'evaluate_metrics',
      this.handleMetricEvaluation.bind(this)
    );

    // Listen for raw metric streams (pub/sub)
    this.acp.listenForEvents<MetricPoint>('metrics.raw', async (payload, msg) => {
      this.analyzer.ingest(payload);
    });

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
       { version: this.identity.version }
    });

    console.log(`📊 Monitoring Agent [${this.id}] initialized and listening for metric streams...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Monitoring Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleMetricEvaluation(
    payload: MetricIngestionRequest,
    message: ACPMessage<MetricIngestionRequest>
  ): Promise<MonitoringReport> {
    const span = this.telemetry.startSpan('monitoring.evaluate_metrics', message.trace_context);
    span.setAttribute('metric_count', payload.metrics.length);

    try {
      const violations: SLOViolation[] = [];
      let anomalyCount = 0;
      let worstSeverity = 'healthy';

      for (const metric of payload.metrics) {
        // 1. Ingest & Update History
        this.analyzer.ingest(metric);

        // 2. Anomaly Detection
        const anomaly = this.analyzer.detectAnomaly(metric);
        if (anomaly?.isAnomaly) {
          anomalyCount++;
          console.warn(`⚠️ Anomaly detected: ${anomaly.metricName} (Z-Score: ${anomaly.zScore.toFixed(2)})`);
        }

        // 3. SLO Evaluation
        for (const slo of payload.sloConfigs) {
          if (slo.metricName === metric.metricName) {
            const passes = this.analyzer.evaluateSLO(metric, slo);
            if (!passes) {
              violations.push({
                metricName: slo.metricName,
                threshold: slo.threshold,
                actualValue: metric.value,
                severity: slo.severity
              });
              if (slo.severity === 'critical') worstSeverity = 'critical';
              else if (slo.severity === 'warning' && worstSeverity !== 'critical') worstSeverity = 'degraded';
            }
          }
        }
      }

      // 4. Alert Routing (if critical violations or high anomaly count)
      if (violations.length > 0 || anomalyCount > 2) {
        await this.triggerAlerts(violations, anomalyCount);
      }

      // 5. Generate Report
      const report: MonitoringReport = {
        reportId: `mon_${Date.now()}`,
        status: worstSeverity as MonitoringReport['status'],
        anomaliesDetected: anomalyCount,
        sloViolations: violations,
        timestamp: Date.now()
      };

      // 6. Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'metric_evaluation_completed',
        status: report.status === 'healthy' ? 'success' : 'warning',
         { reportId: report.reportId, anomalies: anomalyCount, violations: violations.length }
      });

      span.setStatus('ok');
      return report;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Invoke FMEA
      await this.fmea.handle(err, 'monitoring_evaluation_pipeline');

      throw error;
    } finally {
      span.end();
    }
  }

  private async triggerAlerts(violations: SLOViolation[], anomalyCount: number): Promise<void> {
    // Publish alert event to Incident/Notification agents via ACP
    await this.acp.publishEvent('alert.triggered', {
      source: this.id,
      type: 'slo_violation',
      severity: violations.some(v => v.severity === 'critical') ? 'critical' : 'warning',
      violations,
      anomaly_count: anomalyCount,
      timestamp: Date.now()
    });
  }
}
