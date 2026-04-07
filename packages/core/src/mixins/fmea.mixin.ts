// packages/core/src/mixins/fmea.mixin.ts
// FMEA (Failure Mode and Effects Analysis) & Circuit Breaker Implementation
// Implements resilience patterns: Retry, Exponential Backoff, Circuit Breaker, Fallback

import { ResilienceConfig, FMEAEntry, CircuitBreakerState } from '../types';

export class FMEAMixin {
  private config: ResilienceConfig;
  private fmeaTable: FMEAEntry[];
  private circuitBreakers: Map<string, CircuitBreakerState>;

  constructor(config: Partial<ResilienceConfig>, fmeaTable: FMEAEntry[] = []) {
    this.config = {
      max_retries: 3,
      retry_delay_ms: 1000,
      backoff_multiplier: 2,
      circuit_breaker_threshold: 5,
      circuit_breaker_timeout_ms: 30000,
      fallback_enabled: true,
      ...config
    };
    this.fmeaTable = fmeaTable;
    this.circuitBreakers = new Map();
  }

  /**
   * Executes an async operation with retry, circuit breaker, and fallback logic.
   * @param operation The async function to execute
   * @param context Identifier for circuit breaker state tracking (e.g., 'security-osv-api')
   */
  async executeWithResilience<T>(operation: () => Promise<T>, context: string): Promise<T> {
    // 1. Circuit Breaker Check
    if (this.isCircuitOpen(context)) {
      throw new Error(`Circuit breaker OPEN for ${context}. Requests blocked temporarily.`);
    }

    let lastError: Error | null = null;
    let attempts = 0;

    // 2. Retry Loop with Exponential Backoff
    while (attempts <= this.config.max_retries) {
      try {
        const result = await operation();
        this.recordSuccess(context);
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.recordFailure(context);
        attempts++;

        if (attempts <= this.config.max_retries) {
          const delay = this.config.retry_delay_ms * Math.pow(this.config.backoff_multiplier, attempts - 1);
          await this.delay(delay);
        }
      }
    }

    // 3. Fallback Execution (if enabled)
    if (this.config.fallback_enabled) {
      const fallbackAction = this.findFallbackAction(context, lastError);
      if (fallbackAction) {
        console.warn(`[FMEA] Applying fallback for ${context}: ${fallbackAction}`);
        return this.invokeFallback<T>(fallbackAction, context, lastError);
      }
    }

    // 4. All attempts failed, throw original error
    throw lastError;
  }

  /**
   * Explicit error handling method. Logs FMEA match and triggers mitigation if defined.
   */
  async handle(error: Error, context: string): Promise<void> {
    console.error(`[FMEA] Error detected in ${context}:`, error.message);

    const matchedEntry = this.fmeaTable.find(entry =>
      context.toLowerCase().includes(entry.failure_mode.toLowerCase())
    );

    if (matchedEntry) {
      console.warn(`[FMEA] Matched Failure Mode: ${matchedEntry.failure_mode}`);
      console.warn(`[FMEA] Severity: ${matchedEntry.severity} | Probability: ${matchedEntry.probability}`);
      console.warn(`[FMEA] Mitigation Strategy: ${matchedEntry.mitigation_strategy}`);
      console.warn(`[FMEA] Fallback Action: ${matchedEntry.fallback_action}`);

      if (matchedEntry.fallback_action) {
        await this.invokeFallback<void>(matchedEntry.fallback_action, context, error);
      }
    } else {
      console.warn(`[FMEA] No matching failure mode found for context: ${context}`);
    }
  }

  // ==================== PRIVATE HELPERS ====================

  private isCircuitOpen(context: string): boolean {
    const state = this.circuitBreakers.get(context);
    if (!state || state.status === 'closed') return false;

    if (state.status === 'open') {
      if (Date.now() >= state.next_retry_time) {
        state.status = 'half-open'; // Allow one test request
        return false;
      }
      return true; // Still open, block request
    }
    return false; // half-open allows request
  }

  private recordSuccess(context: string): void {
    const state = this.circuitBreakers.get(context);
    if (state) {
      state.status = 'closed';
      state.failures = 0;
      state.last_failure_time = 0;
      state.next_retry_time = 0;
    }
  }

  private recordFailure(context: string): void {
    let state = this.circuitBreakers.get(context);
    if (!state) {
      state = {
        status: 'closed',
        failures: 0,
        last_failure_time: 0,
        next_retry_time: 0
      };
      this.circuitBreakers.set(context, state);
    }

    state.failures++;
    state.last_failure_time = Date.now();

    if (state.failures >= this.config.circuit_breaker_threshold) {
      state.status = 'open';
      state.next_retry_time = Date.now() + this.config.circuit_breaker_timeout_ms;
      console.warn(`[FMEA] Circuit breaker OPENED for ${context}. Timeout: ${this.config.circuit_breaker_timeout_ms}ms`);
    }
  }

  private findFallbackAction(context: string, error: Error): string | null {
    const entry = this.fmeaTable.find(f => context.toLowerCase().includes(f.failure_mode.toLowerCase()));
    return entry ? entry.fallback_action : null;
  }

  private async invokeFallback<T>(action: string, context: string, error: Error): Promise<T> {
    // In a full implementation, this would map 'action' strings to actual handler functions.
    // For now, it logs and returns a safe default or re-throws depending on type.
    console.log(`[FMEA] Executing fallback: ${action} for context: ${context}`);
    // Placeholder for actual fallback execution logic
    throw new Error(`Fallback execution not implemented for action: ${action}. Original error: ${error.message}`);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
