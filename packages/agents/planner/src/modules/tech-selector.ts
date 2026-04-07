// packages/agents/planner/src/modules/tech-selector.ts

export interface TechStack {
  language: string;
  framework: string;
  database: string;
  infra: string;
  reasoning: string;
}

export class TechSelector {
  // Bilgi Tabanı (Knowledge Base)
  private readonly profiles = {
    high_performance: {
      language: 'Rust',
      framework: 'Actix Web',
      database: 'PostgreSQL',
      infra: 'Kubernetes (Bare Metal)',
      reasoning: 'Maximum throughput and low latency required.'
    },
    rapid_development: {
      language: 'TypeScript',
      framework: 'NestJS',
      database: 'MongoDB',
      infra: 'Serverless (AWS Lambda)',
      reasoning: 'Speed to market is critical; dynamic schema needed.'
    },
    enterprise_stable: {
      language: 'Java',
      framework: 'Spring Boot',
      database: 'Oracle / PostgreSQL',
      infra: 'AWS EKS / ECS',
      reasoning: 'Long-term stability, strict typing, and enterprise support.'
    },
    ml_heavy: {
      language: 'Python',
      framework: 'FastAPI',
      database: 'Vector DB (Qdrant)',
      infra: 'GPU Instances',
      reasoning: 'AI/ML workloads require Python ecosystem.'
    }
  };

  select(solvedConstraints: any): TechStack {
    const { constraints } = solvedConstraints;

    // Karar Verme Mantığı
    const needsSpeed = constraints.some((c: any) => c.type === 'performance' && Number(c.value) > 90);
    const needsSpeedyDev = constraints.some((c: any) => c.type === 'time' && Number(c.value) < 30); // 30 günden az
    const hasAI = constraints.some((c: any) => c.type === 'feature' && String(c.value).includes('AI'));

    if (hasAI) return this.profiles.ml_heavy;
    if (needsSpeed) return this.profiles.high_performance;
    if (needsSpeedyDev) return this.profiles.rapid_development;

    // Default
    return this.profiles.enterprise_stable;
  }
}
