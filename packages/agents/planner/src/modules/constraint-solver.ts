// packages/agents/planner/src/modules/constraint-solver.ts

export interface Constraint {
  type: 'budget' | 'time' | 'performance' | 'compliance' | 'scalability';
  value: number | string;
  priority: number; // 1-10
}

export interface SolvedConstraints {
  constraints: Constraint[];
  adjusted: boolean;
  adjustments: string[];
}

export class ConstraintSolver {
  /**
   * Çelişkileri tespit eder ve önceliğe göre çözer.
   * Önceki planımızdaki "Trade-off Analysis" mantığının uygulamasıdır.
   */
  resolve(inputConstraints: Constraint[]): SolvedConstraints {
    console.log(`🔍 ConstraintSolver: Analyzing ${inputConstraints.length} constraints...`);

    const conflicts: string[] = [];
    let adjusted = false;

    // Örnek Çelişki Tespiti: Düşük Bütçe + Yüksek Performans
    const budgetConstraint = inputConstraints.find(c => c.type === 'budget');
    const perfConstraint = inputConstraints.find(c => c.type === 'performance');

    if (budgetConstraint && perfConstraint) {
      // Mantık: Bütçe < 1000 birim VE Performans beklentisi > 90 ise çelişki var.
      const isLowBudget = Number(budgetConstraint.value) < 1000;
      const isHighPerf = Number(perfConstraint.value) > 90;

      if (isLowBudget && isHighPerf) {
        conflicts.push("Low_Budget_High_Perf");

        // Çözüm: Performans beklentini düşür veya bütçeyi artır.
        // Önceliği düşük olanı feda et.
        if (budgetConstraint.priority < perfConstraint.priority) {
           // Performans daha önemli, bütçeyi esnetme uyarısı ver
           console.log("⚠️ Conflict: Performance is high priority but budget is low.");
           adjusted = true;
           conflicts.push("Suggestion: Increase budget or accept lower SLA.");
        } else {
           // Bütçe daha önemli, performansı düşür
           console.log("⚠️ Conflict: Budget is strict. Lowering performance target.");
           perfConstraint.value = 80; // Otomatik revizyon
           adjusted = true;
           conflicts.push("Action: Performance target adjusted to 80.");
        }
      }
    }

    return {
      constraints: inputConstraints,
      adjusted,
      adjustments: conflicts
    };
  }
}
