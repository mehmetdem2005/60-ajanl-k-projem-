// packages/agents/cost-optimizer/src/modules/cost-analyzer.ts
// Cost Analyzer Module
// Statistical analysis of resource utilization vs allocated capacity.
// Generates rightsizing recommendations with safety margins and savings forecasts.

export interface ResourceUsage {
  resourceId: string;
  type: 'compute' | 'storage' | 'database' | 'network';
  allocatedCapacity: number; // e.g., vCPU, GB RAM, IOPS
  currentUsageP50: number;
  currentUsageP95: number;
  currentUsageP99: number;
  costPerUnitPerMonth: number;
}

export interface OptimizationRecommendation {
  resourceId: string;
  currentCapacity: number;
  recommendedCapacity: number;
  estimatedMonthlySavings: number;
  confidenceScore: number; // 0.0 - 1.0
  riskLevel: 'low' | 'medium' | 'high';
  action: 'downsize' | 'upscale' | 'rightsize' | 'terminate';
}

export class CostAnalyzer {
  private readonly WASTE_THRESHOLD = 0.4; // <40% P95 utilization = waste
  private readonly SAFETY_MARGIN = 1.25;  // 25% buffer above P99

  analyze(resources: ResourceUsage[]): OptimizationRecommendation[] {
    return resources.map(res => {
      const utilizationP95 = res.currentUsageP95 / res.allocatedCapacity;
      const utilizationP99 = res.currentUsageP99 / res.allocatedCapacity;

      let recommendation: OptimizationRecommendation;

      if (utilizationP95 < this.WASTE_THRESHOLD) {
        // Significant waste detected -> Downsize
        const recommended = Math.ceil(res.currentUsageP99 * this.SAFETY_MARGIN);
        const savings = (res.allocatedCapacity - recommended) * res.costPerUnitPerMonth;

        recommendation = {
          resourceId: res.resourceId,
          currentCapacity: res.allocatedCapacity,
          recommendedCapacity: Math.max(1, recommended),
          estimatedMonthlySavings: Math.max(0, savings),
          confidenceScore: 0.92,
          riskLevel: 'low',
          action: 'downsize'
        };
      } else if (utilizationP99 > 0.85) {
        // High utilization -> Risk of throttling -> Upscale
        const recommended = Math.ceil(res.currentUsageP99 * this.SAFETY_MARGIN);
        const additionalCost = (recommended - res.allocatedCapacity) * res.costPerUnitPerMonth;

        recommendation = {
          resourceId: res.resourceId,
          currentCapacity: res.allocatedCapacity,
          recommendedCapacity: recommended,
          estimatedMonthlySavings: -additionalCost,
          confidenceScore: 0.88,
          riskLevel: 'high',
          action: 'upscale'
        };
      } else {
        // Optimal range
        recommendation = {
          resourceId: res.resourceId,
          currentCapacity: res.allocatedCapacity,
          recommendedCapacity: res.allocatedCapacity,
          estimatedMonthlySavings: 0,
          confidenceScore: 1.0,
          riskLevel: 'low',
          action: 'rightsize'
        };
      }

      return recommendation;
    });
  }

  calculateTotalSavings(recommendations: OptimizationRecommendation[]): number {
    return recommendations.reduce((sum, rec) => sum + rec.estimatedMonthlySavings, 0);
  }
}
