// packages/core/src/mixins/telemetry.mixin.ts
// Telemetry & Observability Mixin Implementation
// Implements ITelemetry interface from types.ts
// Supports Distributed Tracing and Metrics Recording

import { ITelemetry, Span, SpanContext, MetricRecord, TelemetryConfig } from '../types';
import crypto from 'crypto';

export class TelemetryMixin implements ITelemetry {
  private config: TelemetryConfig;
  private activeSpans: Map<string, Span>;
  private metricQueue: MetricRecord[];

  constructor(config: TelemetryConfig) {
    this.config = {
      service_name: 'unknown-agent',
      sampling_rate: 1.0,
      enable_metrics: true,
      enable_traces: true,
      otlp_endpoint: undefined,
      ...config
    };
    this.activeSpans = new Map();
    this.metricQueue = [];
  }

  /**
   * Starts a new trace span.
   * If parentContext is provided, it links this span as a child.
   */
  startSpan(name: string, parentContext?: SpanContext): Span {
    const traceId = parentContext?.trace_id || crypto.randomUUID();
    const spanId = crypto.randomUUID();

    const spanContext: SpanContext = {
      trace_id: traceId,
      span_id: spanId,
      parent_span_id: parentContext?.span_id
    };

    // Create the Span object with inline method implementations
    const span: Span = {
      id: spanId,
      name,
      context: spanContext,
      start_time: Date.now(),
      status: 'unset',
      attributes: {
        'service.name': this.config.service_name
      },
      events: [],

      // Methods for Span manipulation
      end: (): void => {
        span.end_time = Date.now();
        if (span.status === 'unset') span.status = 'ok';
        this.activeSpans.delete(spanId);
        // In production: Flush span to OTLP collector (Jaeger/Zipkin)
      },

      setAttribute: (key: string, value: string | number | boolean): void => {
        span.attributes[key] = value;
      },

      setStatus: (status: Span['status'], message?: string): void => {
        span.status = status;
        if (message) {
          span.addEvent('status_update', { message });
        }
      },

      addEvent: (eventName: string, attributes?: Record<string, string | number | boolean>): void => {
        span.events.push({
          name: eventName,
          timestamp: Date.now(),
          attributes: attributes || {}
        });
      }
    };

    this.activeSpans.set(spanId, span);
    return span;
  }

  /**
   * Records a metric (Counter, Gauge, or Histogram)
   */
  recordMetric(record: Omit<MetricRecord, 'timestamp'>): void {
    if (!this.config.enable_metrics) return;

    const metric: MetricRecord = {
      ...record,
      timestamp: Date.now()
    };

    this.metricQueue.push(metric);

    // In production: Push to Prometheus/Grafana or OTLP collector
  }

  /**
   * Helper: Records an error on a span and sets status to error.
   */
  recordError(span: Span, error: Error): void {
    span.setStatus('error', error.message);
    span.addEvent('exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack || ''
    });
  }

  /**
   * Extracts trace context from incoming headers (e.g., from ACP message)
   */
  extractContext(headers: Record<string, string>): SpanContext | undefined {
    if (headers['x-trace-id'] && headers['x-span-id']) {
      return {
        trace_id: headers['x-trace-id'],
        span_id: headers['x-span-id'],
        parent_span_id: headers['x-parent-span-id']
      };
    }
    return undefined;
  }

  /**
   * Injects current span context into outgoing headers
   */
  injectContext(span: Span): Record<string, string> {
    return {
      'x-trace-id': span.context.trace_id,
      'x-span-id': span.context.span_id
    };
  }
}
