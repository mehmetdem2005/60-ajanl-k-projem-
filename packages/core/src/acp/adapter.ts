// packages/core/src/acp/adapter.ts
// Agent Communication Protocol (ACP) Adapter Implementation
// Handles message routing, request/response lifecycle, pub/sub, and distributed tracing
// Transport-agnostic design (defaults to InMemory for dev/test, swappable for NATS/gRPC)

import crypto from 'crypto';
import { AgentIdentity, Span, TelemetryMixin } from '../types';
import {
  ACPMessage,
  ACPResponse,
  ACPMessageType,
  AgentEndpoint
} from './types';

// ==================== TRANSPORT ABSTRACTION ====================
export interface IMessageBroker {
  publish(subject: string, message: Buffer): Promise<void>;
  subscribe(subject: string, callback: (message: Buffer) => void): Promise<() => void>;
  request(subject: string, message: Buffer, timeoutMs: number): Promise<Buffer>;
  dispose(): Promise<void>;
}

// Development/Test In-Memory Broker Implementation
export class InMemoryBroker implements IMessageBroker {
  private subscribers: Map<string, Set<(msg: Buffer) => void>> = new Map();
  private pendingRequests: Map<string, { resolve: (b: Buffer) => void; reject: (e: Error) => void; timeout: NodeJS.Timeout }> = new Map();

  async publish(subject: string, message: Buffer): Promise<void> {
    const subs = this.subscribers.get(subject) || new Set();
    subs.forEach(cb => cb(message));
  }

  async subscribe(subject: string, callback: (message: Buffer) => void): Promise<() => void> {
    if (!this.subscribers.has(subject)) {
      this.subscribers.set(subject, new Set());
    }
    this.subscribers.get(subject)!.add(callback);
    return () => this.subscribers.get(subject)?.delete(callback);
  }

  async request(subject: string, message: Buffer, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const conversationId = JSON.parse(message.toString()).conversation_id;
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(conversationId);
        reject(new Error(`Request timeout for conversation ${conversationId} after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(conversationId, { resolve, reject, timeout });

      // Route request to subject subscribers
      const subs = this.subscribers.get(subject) || new Set();
      if (subs.size === 0) {
        clearTimeout(timeout);
        this.pendingRequests.delete(conversationId);
        reject(new Error(`No subscribers found for subject: ${subject}`));
        return;
      }
      subs.forEach(cb => cb(message));
    });
  }

  // Internal: Handle incoming reply messages
  handleReply(conversationId: string, payload: Buffer): boolean {
    const pending = this.pendingRequests.get(conversationId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(conversationId);
      pending.resolve(payload);
      return true;
    }
    return false;
  }

  async dispose(): Promise<void> {
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timeout);
      req.reject(new Error('Broker disposed'));
    }
    this.pendingRequests.clear();
    this.subscribers.clear();
  }
}

// ==================== ACP ADAPTER ====================
export interface ACPAdapterConfig {
  identity: AgentIdentity;
  telemetry: TelemetryMixin;
  broker?: IMessageBroker;
  defaultTimeoutMs?: number;
}

export class ACPAdapter {
  private identity: AgentIdentity;
  private telemetry: TelemetryMixin;
  private broker: IMessageBroker;
  private defaultTimeoutMs: number;
  private unsubscribeHandlers: (() => void)[] = [];

  constructor(config: ACPAdapterConfig) {
    this.identity = config.identity;
    this.telemetry = config.telemetry;
    this.broker = config.broker || new InMemoryBroker();
    this.defaultTimeoutMs = config.defaultTimeoutMs || 30000;
  }

  /**
   * Sends a task to a specific agent and waits for a response.
   * Automatically handles conversation tracking, timeouts, and tracing.
   */
  async sendTask<TReq, TRes>(
    recipientId: string,
    action: string,
    payload: TReq,
    timeoutMs?: number
  ): Promise<TRes> {
    const span = this.telemetry.startSpan('acp.send_task', this.telemetry.extractContext({}));
    span.setAttribute('recipient', recipientId);
    span.setAttribute('action', action);

    const conversationId = crypto.randomUUID();
    const message: ACPMessage<TReq> = {
      message_id: crypto.randomUUID(),
      conversation_id: conversationId,
      sender: this.identity,
      recipient: recipientId,
      type: 'TASK_REQUEST',
      payload,
      timestamp: Date.now(),
      ttl_seconds: Math.ceil((timeoutMs || this.defaultTimeoutMs) / 1000),
      headers: {
        action,
        'x-trace-id': span.context.trace_id,
        'x-span-id': span.context.span_id,
        schema_version: '1.0'
      }
    };

    try {
      const subject = `agent.${recipientId}.tasks`;
      const rawResponse = await this.broker.request(
        subject,
        Buffer.from(JSON.stringify(message)),
        timeoutMs || this.defaultTimeoutMs
      );

      const response: ACPResponse<TRes> = JSON.parse(rawResponse.toString());

      if (response.status === 'error') {
        span.setStatus('error', response.error?.message);
        throw new Error(`Agent ${recipientId} returned error [${response.error?.code}]: ${response.error?.message}`);
      }

      if (response.status === 'negotiation_required') {
        span.setStatus('error', 'Negotiation required');
        throw new Error(`Agent ${recipientId} requires negotiation. Counter-proposal: ${JSON.stringify(response.negotiation)}`);
      }

      span.setStatus('ok');
      return response.data as TRes;
    } catch (error) {
      span.setStatus('error', error instanceof Error ? error.message : 'Unknown error');
      this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Publishes an event to a subject (fire-and-forget).
   */
  async publishEvent<T>(subject: string, payload: T): Promise<void> {
    const span = this.telemetry.startSpan('acp.publish_event');
    span.setAttribute('subject', subject);

    const message: ACPMessage<T> = {
      message_id: crypto.randomUUID(),
      conversation_id: crypto.randomUUID(),
      sender: this.identity,
      recipient: '*',
      type: 'EVENT_PUBLISH',
      payload,
      timestamp: Date.now(),
      headers: {
        'x-trace-id': span.context.trace_id,
        'x-span-id': span.context.span_id
      }
    };

    try {
      await this.broker.publish(`events.${subject}`, Buffer.from(JSON.stringify(message)));
      span.setStatus('ok');
    } catch (error) {
      span.setStatus('error', error instanceof Error ? error.message : 'Publish failed');
      this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      throw error;
    } finally {
      span.end();
    }
  }

  /**
   * Registers a handler for incoming task requests matching a specific action.
   */
  listenForTasks<TReq, TRes>(
    action: string,
    handler: (payload: TReq, message: ACPMessage<TReq>) => Promise<TRes>
  ): void {
    const subject = `agent.${this.identity.agent_id}.tasks`;

    this.broker.subscribe(subject, async (rawMessage: Buffer) => {
      const message: ACPMessage<TReq> = JSON.parse(rawMessage.toString());

      if (message.headers?.action !== action) return;
      if (message.recipient !== '*' && message.recipient !== this.identity.agent_id) return;

      const span = this.telemetry.startSpan(`acp.handle_${action}`, message.trace_context);
      span.setAttribute('sender', message.sender.agent_id);
      span.setAttribute('conversation_id', message.conversation_id);

      try {
        const result = await handler(message.payload, message);
        const response: ACPResponse<TRes> = {
          conversation_id: message.conversation_id,
          status: 'success',
          data: result,
          headers: { 'x-trace-id': span.context.trace_id }
        };

        // If broker supports direct reply routing, use it. Otherwise publish to reply subject.
        if ((this.broker as any).handleReply) {
          (this.broker as any).handleReply(message.conversation_id, Buffer.from(JSON.stringify(response)));
        } else {
          await this.broker.publish(`reply.${message.conversation_id}`, Buffer.from(JSON.stringify(response)));
        }

        span.setStatus('ok');
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        span.setStatus('error', err.message);
        this.telemetry.recordError(span, err);

        const errorResponse: ACPResponse = {
          conversation_id: message.conversation_id,
          status: 'error',
          error: {
            code: 'HANDLER_ERROR',
            message: err.message,
            recoverable: true
          },
          headers: { 'x-trace-id': span.context.trace_id }
        };

        if ((this.broker as any).handleReply) {
          (this.broker as any).handleReply(message.conversation_id, Buffer.from(JSON.stringify(errorResponse)));
        } else {
          await this.broker.publish(`reply.${message.conversation_id}`, Buffer.from(JSON.stringify(errorResponse)));
        }
      } finally {
        span.end();
      }
    }).then(unsub => this.unsubscribeHandlers.push(unsub));
  }

  /**
   * Registers a handler for incoming events on a specific subject.
   */
  listenForEvents<T>(
    subject: string,
    handler: (payload: T, message: ACPMessage<T>) => Promise<void> | void
  ): void {
    this.broker.subscribe(`events.${subject}`, async (rawMessage: Buffer) => {
      const message: ACPMessage<T> = JSON.parse(rawMessage.toString());

      const span = this.telemetry.startSpan(`acp.event_${subject}`, message.trace_context);
      try {
        await handler(message.payload, message);
        span.setStatus('ok');
      } catch (error) {
        span.setStatus('error', error instanceof Error ? error.message : 'Event handler failed');
        this.telemetry.recordError(span, error instanceof Error ? error : new Error(String(error)));
      } finally {
        span.end();
      }
    }).then(unsub => this.unsubscribeHandlers.push(unsub));
  }

  /**
   * Gracefully shuts down the adapter, clears pending requests, and removes subscriptions.
   */
  async dispose(): Promise<void> {
    for (const unsub of this.unsubscribeHandlers) {
      unsub();
    }
    this.unsubscribeHandlers = [];
    await this.broker.dispose();
  }
}
