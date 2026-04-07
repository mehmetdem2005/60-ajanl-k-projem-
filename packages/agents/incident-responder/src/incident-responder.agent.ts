// packages/agents/incident-responder/src/incident-responder.agent.ts
// Incident Responder Agent Implementation
// Ingests alerts, prioritizes incidents, executes automated runbooks,
// coordinates cross-agent remediation, and closes incidents.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { v4 as uuidv4 } from 'uuid';
import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { RunbookExecutor, Runbook, RunbookExecutionResult } from './modules/runbook-executor';

// ==================== DATA TYPES ====================

export interface AlertPayload {
  alertId: string;
  metricName: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  timestamp: number;
  context: Record<string, any>;
}

export interface IncidentRecord {
  incidentId: string;
  alertId: string;
  status: 'open' | 'mitigating' | 'resolved' | 'escalated';
  severity: string;
  assignedRunbook?: string;
  remediationResult?: RunbookExecutionResult;
  createdAt: number;
  updatedAt: number;
}

// ==================== AGENT CLASS ====================

export class IncidentResponderAgent extends BaseAgent {
  private executor: RunbookExecutor;
  private activeIncidents: Map<string, IncidentRecord> = new Map();

  constructor(config: AgentConfig) {
    // FMEA entries specific to incident response
    const incidentFmea: FMEAEntry[] = [
      {
        failure_mode: 'RUNBOOK_EXECUTION_TIMEOUT',
        probability: 0.15,
        severity: 'critical',
        detection_method: 'Step execution exceeds defined timeout',
        mitigation_strategy: 'Abort runbook, escalate to human SRE',
        fallback_action: 'Preserve system state, open manual ticket'
      },
      {
        failure_mode: 'FALSE_POSITIVE_MITIGATION',
        probability: 0.08,
        severity: 'high',
        detection_method: 'System health improves immediately after alert suppression',
        mitigation_strategy: 'Add hysteresis to alerting, require 3 consecutive failures',
        fallback_action: 'Log event, update model training dataset'
      }
    ];

    super(config, incidentFmea);
    this.executor = new RunbookExecutor();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['incident_triage', 'runbook_execution', 'cross_agent_coordination', 'auto_remediation'];
  }

  protected async onInit(): Promise<void> {
    // Listen for alerts from Monitoring Agent
    this.acp.listenForEvents<AlertPayload>('alert.triggered', async (payload) => {
      await this.handleIncomingAlert(payload);
    });

    // Listen for direct remediation requests
    this.acp.listenForTasks<AlertPayload, IncidentRecord>(
      'create_incident',
      this.handleCreateIncident.bind(this)
    );

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`🚨 Incident Responder Agent [${this.id}] initialized and listening for alerts...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Incident Responder Agent [${this.id}] is shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleIncomingAlert(alert: AlertPayload): Promise<void> {
    const span = this.telemetry.startSpan('incident.handle_alert');
    span.setAttribute('alertId', alert.alertId);
    span.setAttribute('severity', alert.severity);

    try {
      console.log(`📥 Alert received: ${alert.message} (${alert.severity})`);

      // 1. Deduplication & Prioritization
      if (alert.severity !== 'critical' && this.hasActiveIncident(alert.alertId)) {
        console.log(`ℹ️ Duplicate/non-critical alert ignored: ${alert.alertId}`);
        return;
      }

      // 2. Create Incident Record
      const incident: IncidentRecord = {
        incidentId: `inc_${uuidv4().slice(0, 8)}`,
        alertId: alert.alertId,
        status: 'open',
        severity: alert.severity,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      this.activeIncidents.set(incident.incidentId, incident);

      // 3. Auto-Remediation for Critical Alerts
      if (alert.severity === 'critical') {
        incident.status = 'mitigating';
        const runbook = this.selectRunbook(alert);
        incident.assignedRunbook = runbook.id;

        console.log(`🚨 Critical incident ${incident.incidentId}. Executing runbook: ${runbook.name}`);
        const execResult = await this.executor.execute(runbook);
        incident.remediationResult = execResult;
        incident.status = execResult.status === 'completed' ? 'resolved' : 'escalated';
        incident.updatedAt = Date.now();

        // Notify relevant agents based on outcome
        if (execResult.status === 'failed') {
          await this.acp.publishEvent('incident.escalation', { incident, alert });
        } else {
          await this.acp.publishEvent('incident.resolved', { incident });
        }
      } else {
        // Warning/Info: Log and monitor
        incident.status = 'open';
        console.log(`📋 Incident logged: ${incident.incidentId}. Monitoring for auto-resolution.`);
      }

      // Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'incident_processed',
        status: incident.status,
         data: { incidentId: incident.incidentId, severity: incident.severity }
      });

      span.setStatus('ok');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);
      await this.fmea.handle(err, 'incident_responder_pipeline');
    } finally {
      span.end();
    }
  }

  private async handleCreateIncident(payload: AlertPayload): Promise<IncidentRecord> {
    await this.handleIncomingAlert(payload);
    // Return most recently created incident for this alert
    return Array.from(this.activeIncidents.values()).pop()!;
  }

  // ==================== PRIVATE HELPERS ====================

  private hasActiveIncident(alertId: string): boolean {
    // Simple check: in production, use a database with TTL
    for (const inc of this.activeIncidents.values()) {
      if (inc.alertId === alertId && inc.status !== 'resolved') return true;
    }
    return false;
  }

  private selectRunbook(alert: AlertPayload): Runbook {
    // Mock runbook selection based on alert context
    return {
      id: 'rb_auto_restart',
      name: 'Auto-Restart Degraded Service',
      triggerCondition: 'high_error_rate || health_check_fail',
      severity: 'critical',
      steps: [
        {
          id: 'step_1',
          name: 'Scale down to 0',
          action: 'scale_replicas',
          target: alert.context.service || 'unknown',
          params: { replicas: 0 },
          timeoutMs: 10000,
          compensation: { action: 'scale_replicas', target: alert.context.service || 'unknown', params: { replicas: 1 } }
        },
        {
          id: 'step_2',
          name: 'Scale up to original count',
          action: 'scale_replicas',
          target: alert.context.service || 'unknown',
          params: { replicas: 2 },
          timeoutMs: 15000
        }
      ]
    };
  }
}
