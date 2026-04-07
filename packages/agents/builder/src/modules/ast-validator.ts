// packages/agents/builder/src/modules/ast-validator.ts
// AST (Abstract Syntax Tree) Validator Module
// Ensures generated code structure matches architectural requirements.

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ASTValidator {
  /**
   * Validates code structure against expected architectural patterns.
   * In production, integrates with @typescript-eslint/parser or Babel for deep AST traversal.
   */
  validateStructure(code: string, expected: { hasAuth: boolean; hasDB: boolean }): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Structural pattern matching (Simplified for core logic demonstration)
    const hasAuthImport = /import\s+.*auth|require\(['"].*auth['"]\)/i.test(code);
    const hasDBImport = /import\s+.*database|require\(['"].*db['"]\)/i.test(code);
    const hasMainExport = /export\s+(default\s+)?(class|function|const)/i.test(code);
    const hasSecurityHeaders = /helmet|cors|x-frame-options/i.test(code);

    if (expected.hasAuth && !hasAuthImport) {
      errors.push('Missing authentication module import');
    }
    if (expected.hasDB && !hasDBImport) {
      errors.push('Missing database module import');
    }
    if (!hasMainExport) {
      warnings.push('No main export detected (class/function)');
    }
    if (!hasSecurityHeaders) {
      warnings.push('Security middleware/headers not explicitly configured');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}
