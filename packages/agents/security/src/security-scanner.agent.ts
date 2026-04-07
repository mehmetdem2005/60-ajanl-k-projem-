// packages/agents/security/src/security-scanner.agent.ts
// Security Scanner Agent Implementation
// Scans dependencies/artifacts, correlates CVEs, calculates risk scores,
// and enforces security gates.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { CVECorrelator, Dependency, CorrelatedRisk } from './modules/cve-correlator';

// ==================== DATA TYPES ====================

export interface ScanRequest {
  buildId: string;
  dependencies: Dependency[];
  context: 'public' | 'internal' | 'isolated';
  maxRiskThreshold: number; // e.g., 70
}

export interface SecurityReport {
  scanId: string;
  status: 'pass' | 'fail' | 'warning';
  totalDependencies: number;
  vulnerableDependencies: number;
  criticalFindings: number;
  riskBreakdown: CorrelatedRisk[];
  recommendations: string[];
}

// ==================== AGENT CLASS ====================

export class SecurityScannerAgent extends BaseAgent {
  private correlator: CVECorrelator;

  constructor(config: AgentConfig) {
    // FMEA entries specific to security scanning
    const securityFmea: FMEAEntry[] = [
      {
        failure_mode: 'VULN_API_TIMEOUT',
        probability: 0.08,
        severity: 'medium',
        detection_method: 'Request timeout > 10s',
        mitigation_strategy: 'Retry with backoff, use cached DB',
        fallback_action: 'Run scan with cached vulnerability data'
      },
      {
        failure_mode: 'RISK_SCORE_CALCULATION_ERROR',
        probability: 0.02,
        severity: 'high',
        detection_method: 'NaN or undefined score',
        mitigation_strategy: 'Fallback to CVSS-only scoring',
        fallback_action: 'Fail scan and alert security team'
      }
    ];

    super(config, securityFmea);
    this.correlator = new CVECorrelator();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['dependency_scanning', 'cve_correlation', 'risk_scoring', 'security_gating'];
  }

  protected async onInit(): Promise<void> {
    this.acp.listenForTasks<ScanRequest, SecurityReport>(
      'scan_artifacts',
      this.handleScan.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🛡️ Security Scanner Agent [${this.id}] initialized and listening for scan tasks...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Security Scanner Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleScan(
    payload: ScanRequest,
    message: ACPMessage<ScanRequest>
  ): Promise<SecurityReport> {
    const span = this.telemetry.startSpan('security.scan_artifacts', message.trace_context);
    span.setAttribute('buildId', payload.buildId);

    try {
      console.log(`🔍 Scanning ${payload.dependencies.length} dependencies for build ${payload.buildId}...`);

      // 1. Correlate CVEs
      const riskBreakdown = await this.correlator.correlate(payload.dependencies);

      // 2. Filter by threshold & calculate stats
      const criticalFindings = riskBreakdown.filter(r => r.max_risk_score >= payload.maxRiskThreshold).length;
      const vulnerableCount = riskBreakdown.length;

      // 3. Determine Status
      let status: 'pass' | 'fail' | 'warning' = 'pass';
      if (criticalFindings > 0) {
        status = 'fail';
        console.error(`🚨 Critical vulnerabilities found (${criticalFindings}). Failing scan.`);
      } else if (vulnerableCount > 0) {
        status = 'warning';
      }

      // 4. Generate Report
      const report: SecurityReport = {
        scanId: `scan_${Date.now()}`,
        status,
        totalDependencies: payload.dependencies.length,
        vulnerableDependencies: vulnerableCount,
        criticalFindings,
        riskBreakdown,
        recommendations: criticalFindings > 0
          ? ['Block deployment', 'Patch critical dependencies immediately']
          : vulnerableCount > 0
            ? ['Schedule dependency updates in next sprint']
            : ['Continue deployment', 'No immediate action required']
      };

      // 5. Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'scan_completed',
        status: status === 'pass' ? 'success' : 'failure',
         data: { scanId: report.scanId, critical: criticalFindings }
      });

      span.setStatus('ok');
      return report;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);

      // Invoke FMEA
      await this.fmea.handle(err, 'security_scan_pipeline');

      throw error;
    } finally {
      span.end();
    }
  }
}
