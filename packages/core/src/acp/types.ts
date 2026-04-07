// packages/core/src/acp/types.ts
// Agent Communication Protocol (ACP) Type Definitions
// Strict TypeScript | Zero Hallucination | Production Ready

import { AgentIdentity, SpanContext } from '../types';

// ==================== MESSAGE TYPES ====================
export type ACPMessageType =
  | 'TASK_REQUEST'
  | 'TASK_RESPONSE'
  | 'EVENT_PUBLISH'
  | 'NEGOTIATION_PROPOSAL'
  | 'NEGOTIATION_RESPONSE'
  | 'HEALTH_CHECK'
  | 'SHUTDOWN'
  | 'REGISTRATION';

// ==================== CORE MESSAGE STRUCTURE ====================
export interface ACPMessage<T = any> {
  message_id: string;          // UUID v4
  conversation_id: string;     // Links request/response pairs
  sender: AgentIdentity;       // Strict sender identity
  recipient: string;           // Target agent_id or '*' for broadcast
  type: ACPMessageType;
  payload: T;
  timestamp: number;           // Unix epoch ms
  ttl_seconds?: number;        // Time-to-live for message expiry
  signature?: string;          // HMAC/JWT signature for integrity
  headers: Record<string, string>; // Custom metadata (priority, schema_version, etc.)
  trace_context?: SpanContext; // Distributed tracing linkage
}

// ==================== RESPONSE STRUCTURE ====================
export interface ACPResponse<T = any> {
  conversation_id: string;
  status: 'success' | 'error' | 'negotiation_required' | 'timeout';
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
  headers?: Record<string, string>;
}

// ==================== SERVICE DISCOVERY ====================
export interface AgentEndpoint {
  agent_id: string;
  version: string;
  host: string;
  port: number;
  protocol: 'http' | 'grpc' | 'nats' | 'mqtt';
  capabilities: string[];
  last_heartbeat: number;
  status: 'online' | 'offline' | 'degraded';
}

export interface RegistryResponse {
  status: 'success' | 'error';
  agent?: AgentEndpoint;
  agents?: AgentEndpoint[];
  error?: string;
  timestamp: number;
}

// ==================== NEGOTIATION CONTEXT ====================
export interface NegotiationContext {
  proposal_id: string;
  initiator: string;
  responder: string;
  resource: string;
  terms: Record<string, any>;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  deadline: number;
}

// ==================== VALIDATION & SCHEMA ====================
export interface MessageSchema {
  $schema: string;
  type: string;
  properties?: Record<string, any>;
  required?: string[];
  additionalProperties?: boolean;
}
