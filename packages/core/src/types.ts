// packages/core/src/types.ts
// Core Type Definitions for Planner Agent Ecosystem v1.0.0-stable
// Strict TypeScript | Zero Hallucination Policy | Production Ready

export type Environment = 'development' | 'staging' | 'production' | 'testing';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

// ==================== AGENT IDENTITY & CONFIG ====================
export interface AgentIdentity {
  agent_id: string;
  version: string;
  region: string;
  environment: Environment;
  type: 'infrastructure' | 'security' | 'ai' | 'meta' | 'operations' | 'data' | 'interface';
}

export interface AgentConfig {
  identity: AgentIdentity;
  env?: Record<string, string>; // Ortam değişkenleri için eklendi
  telemetry?: TelemetryConfig;
  audit?: AuditConfig;
  resilience?: ResilienceConfig;
  acp?: ACPConfig;
  [key: string]: any; // Agent-specific custom configuration allowed
}

// ==================== TELEMETRY & OBSERVABILITY ====================
export interface TelemetryConfig {
  service_name: string;
  sampling_rate: number; // 0.0 to 1.0
  otlp_endpoint?: string;
  enable_metrics: boolean;
  enable_traces: boolean;
}

export interface SpanContext {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
}

export interface Span {
  id: string;
  name: string;
  context: SpanContext;
  start_time: number;
  end_time?: number;
  status: 'unset' | 'ok' | 'error';
  attributes: Record<string, string | number | boolean>;
  events: SpanEvent[];
  end(): void;
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: Span['status'], message?: string): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean>): void;
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: Record<string, string | number | boolean>;
}

export interface MetricRecord {
  name: string;
  value: number;
  type: 'counter' | 'gauge' | 'histogram';
  labels?: Record<string, string>;
  timestamp: number;
}

// ==================== AUDIT & IMMUTABLE LOGGING ====================
export interface AuditConfig {
  storage_driver: 'memory' | 'postgres' | 's3' | 'qldb';
  encryption_enabled: boolean;
  retention_days: number;
  worm_mode: boolean;
}

export interface AuditEntry {
  id: string;
  timestamp: string; // ISO 8601
  agent_id: string;
  action: string;
  status: 'success' | 'failure' | 'warning';
  data: Record<string, any>;
  prev_hash: string;
  hash: string;
  signature?: string; // Optional JWT/HMAC signature for tamper-proofing
}

// ==================== RESILIENCE & FMEA ====================
export interface ResilienceConfig {
  max_retries: number;
  retry_delay_ms: number;
  backoff_multiplier: number;
  circuit_breaker_threshold: number;
  circuit_breaker_timeout_ms: number;
  fallback_enabled: boolean;
}

export interface FMEAEntry {
  failure_mode: string;
  probability: number; // 0.0 to 1.0
  severity: 'low' | 'medium' | 'high' | 'critical';
  detection_method: string;
  mitigation_strategy: string;
  fallback_action: string;
}

export interface CircuitBreakerState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  last_failure_time: number;
  next_retry_time: number;
}

// ==================== ACP (AGENT COMMUNICATION PROTOCOL) ====================
export type ACPMessageType =
  | 'TASK_REQUEST'
  | 'TASK_RESPONSE'
  | 'EVENT_PUBLISH'
  | 'NEGOTIATION_PROPOSAL'
  | 'NEGOTIATION_RESPONSE'
  | 'HEALTH_CHECK'
  | 'SHUTDOWN';

export interface ACPConfig {
  broker_url: string;
  auth_token?: string;
  tls_enabled: boolean;
  timeout_ms: number;
  max_message_size_bytes: number;
}

export interface ACPEnvelope<T = any> {
  message_id: string;
  conversation_id: string;
  sender: string; // agent_id
  recipient: string; // agent_id or '*' for broadcast
  type: ACPMessageType;
  payload: T;
  timestamp: number;
  ttl_seconds?: number;
  signature?: string;
  headers: Record<string, string>; // trace_id, priority, schema_version, etc.
}

export type ACPResponseStatus = 'success' | 'error' | 'negotiation_required' | 'timeout';

export interface ACPResponse<T = any> {
  conversation_id: string;
  status: ACPResponseStatus;
  data?: T;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    details?: Record<string, any>;
  };
  negotiation?: {
    counter_proposal: any;
    reason: string;
    expires_at: number;
  };
}

// ==================== WORKFLOW & SAGA ====================
export interface SagaStep<TReq = any, TRes = any> {
  name: string;
  agent_id: string;
  action: string;
  payload: TReq;
  compensation?: {
    action: string;
    payload?: any;
  };
  timeout_ms?: number;
  retries?: number;
}

export type SagaStatus = 'pending' | 'running' | 'completed' | 'compensating' | 'failed' | 'cancelled';

export interface SagaExecution {
  id: string;
  status: SagaStatus;
  started_at: number;
  completed_at?: number;
  steps: SagaStepStatus[];
  results: Record<string, any>;
  error?: {
    step_name: string;
    message: string;
    compensation_applied: boolean;
  };
}

export interface SagaStepStatus {
  name: string;
  agent_id: string;
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'compensated' | 'skipped';
  started_at?: number;
  completed_at?: number;
  result?: any;
  error?: string;
}

// ==================== HEALTH & SYSTEM STATUS ====================
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface HealthCheckResult {
  agent_id: string;
  status: HealthStatus;
  uptime_ms: number;
  version: string;
  checks: Record<string, { status: 'pass' | 'fail' | 'warn'; message?: string }>;
  timestamp: number;
}

export interface SystemStatus {
  total_agents: number;
  healthy_agents: number;
  active_sagas: number;
  queue_depth: number;
  avg_latency_ms: number;
  timestamp: number;
}

// ==================== VALIDATION & SCHEMAS ====================
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  schema_version: string;
}

export interface JsonSchema {
  $schema: string;
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: any;
}
