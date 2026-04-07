// packages/agents/cost-optimizer/src/cost-optimizer.agent.ts
// Cost Optimizer Agent Implementation
// Analyzes resource utilization, generates rightsizing recommendations,
// forecasts savings, and triggers FinOps alerts via ACP.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { CostAnalyzer, ResourceUsage, OptimizationRecommendation } from './modules/cost-analyzer';

// ==================== DATA TYPES ====================

export interface CostAnalysisRequest {
  resourceId?: string;
  billingPeriod: 'monthly' | 'quarterly' | 'yearly';
  includeRecommendations: boolean;
}

export interface CostReport {
  reportId: string;
  period: string;
  totalCurrentCost: number;
  estimatedOptimizedCost: number;
  totalPotentialSavings: number;
  savingsPercentage: number;
  recommendations: OptimizationRecommendation[];
  riskSummary: { low: number; medium: number; high: number };
  timestamp: number;
}

// ==================== AGENT CLASS ====================

export class CostOptimizerAgent extends BaseAgent {
  private analyzer: CostAnalyzer;

  constructor(config: AgentConfig) {
    // FMEA entries specific to cost analysis & cloud billing APIs
    const costFmea: FMEAEntry[] = [
      {
        failure_mode: 'BILLING_API_TIMEOUT',
        probability: 0.05,
        severity: 'medium',
        detection_method: 'Cloud provider API response > 30s',
        mitigation_strategy: 'Retry with exponential backoff, use cached metrics',
        fallback_action: 'Generate report based on last 30-day average'
      },
      {
        failure_mode: 'FALSE_POSITIVE_DOWNSIZE',
        probability: 0.08,
        severity: 'high',
        detection_method: 'Post-optimization utilization spikes > 90%',
        mitigation_strategy: 'Enforce conservative safety margin (25%), require 14-day data window',
        fallback_action: 'Rollback capacity, alert FinOps team, disable auto-apply'
      }
    ];

    super(config, costFmea);
    this.analyzer = new CostAnalyzer();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['cost_analysis', 'resource_rightsizing', 'savings_forecast', 'waste_detection'];
  }

  protected async onInit(): Promise<void> {
    this.acp.listenForTasks<CostAnalysisRequest, CostReport>(
      'analyze_costs',
      this.handleCostAnalysis.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
       { version: this.identity.version }
    });

    console.log(`💰 Cost Optimizer Agent [${this.id}] initialized and listening for analysis tasks...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Cost Optimizer Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleCostAnalysis(
    payload: CostAnalysisRequest,
    message: ACPMessage<CostAnalysisRequest>
  ): Promise<CostReport> {
    const span = this.telemetry.startSpan('cost_optimizer.analyze_costs', message.trace_context);
    span.setAttribute('period', payload.billingPeriod);

    try {
      console.log(`📊 Analyzing costs for period: ${payload.billingPeriod}...`);

      // 1. Fetch Resource Metrics (Mock in dev, real cloud billing/metrics API in prod)
      const resources = await this.fetchResourceMetrics(payload);

      // 2. Analyze & Generate Recommendations
      const recommendations = payload.includeRecommendations
        ? this.analyzer.analyze(resources)
        : [];

      const totalCurrentCost = resources.reduce((sum, r) => sum + (r.allocatedCapacity * r.costPerUnitPerMonth), 0);
      const totalSavings = this.analyzer.calculateTotalSavings(recommendations);
      const estimatedOptimizedCost = totalCurrentCost - totalSavings;

      // 3. Risk Summary
      const riskSummary = {
        low: recommendations.filter(r => r.riskLevel === 'low').length,
        medium: recommendations.filter(r => r.riskLevel === 'medium').length,
        high: recommendations.filter(r => r.riskLevel === 'high').length
      };

      // 4. Generate Report
      const report: CostReport = {
        reportId: `cost_${Date.now()}`,
        period: payload.billingPeriod,
        totalCurrentCost,
        estimatedOptimizedCost,
        totalPotentialSavings: totalSavings,
        savingsPercentage: totalCurrentCost > 0 ? (totalSavings / totalCurrentCost) * 100 : 0,
        recommendations,
        riskSummary,
        timestamp: Date.now()
      };

      // 5. Publish Optimization Opportunity Event
      if (totalSavings > 50) { // Threshold in USD/EUR
        await this.acp.publishEvent('cost.optimization_opportunity', {
          source: this.id,
          savings: totalSavings,
          reportId: report.reportId,
          high_risk_items: riskSummary.high
        });
      }

      // 6. Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'cost_analysis_completed',
        status: 'success',
         { reportId: report.reportId, savings: totalSavings, savings_pct: report.savingsPercentage }
      });

      span.setStatus('ok');
      return report;

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);
      
      // Invoke FMEA
      await this.fmea.handle(err, 'cost_analysis_pipeline');
      
      throw error;
    } finally {
      span.end();
    }
  }

  private async fetchResourceMetrics(payload: CostAnalysisRequest): Promise<ResourceUsage[]> {
    // Mock data simulating cloud provider metrics (AWS Cost Explorer / GCP Billing)
    return [
      {
        resourceId: 'prod-web-server-1',
        type: 'compute',
        allocatedCapacity: 8,
        currentUsageP50: 1.2,
        currentUsageP95: 2.1,
        currentUsageP99: 2.5,
        costPerUnitPerMonth: 25
      },
      {
        resourceId: 'prod-db-primary',
        type: 'database',
        allocatedCapacity: 64,
        currentUsageP50: 48,
        currentUsageP95: 55,
        currentUsageP99: 58,
        costPerUnitPerMonth: 12
      },
      {
        resourceId: 'staging-api-cluster',
        type: 'compute',
        allocatedCapacity: 16,
        currentUsageP50: 0.5,
        currentUsageP95: 1.0,
        currentUsageP99: 1.2,
        costPerUnitPerMonth: 20
      }
    ];
  }
}
