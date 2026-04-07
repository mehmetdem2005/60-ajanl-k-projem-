// packages/agents/notification/src/notification.agent.ts
// Notification Agent Implementation
// Receives alerts/requests, formats messages, routes via ChannelManager,
// tracks delivery status, and publishes delivery reports via ACP.
// Extends BaseAgent for standard lifecycle, telemetry, audit, and FMEA capabilities.

import { BaseAgent, AgentConfig, FMEAEntry, ACPMessage } from '@planner/core';
import { ChannelManager, DeliveryResult, AlertPriority } from './modules/channel-manager';

// ==================== DATA TYPES ====================

export interface NotificationRequest {
  recipients: string[]; // e.g., ['#dev-team', 'oncall@company.com']
  priority: AlertPriority;
  title: string;
  message: string;
  context?: Record<string, any>;
}

export interface NotificationReport {
  requestId: string;
  status: 'sent' | 'partial' | 'failed';
  deliveries: DeliveryResult[];
  timestamp: number;
}

// ==================== AGENT CLASS ====================

export class NotificationAgent extends BaseAgent {
  private channelManager: ChannelManager;

  constructor(config: AgentConfig) {
    // FMEA entries specific to notification delivery
    const notificationFmea: FMEAEntry[] = [
      {
        failure_mode: 'PROVIDER_API_UNAVAILABLE',
        probability: 0.1,
        severity: 'medium',
        detection_method: 'HTTP 5xx or timeout from Slack/PagerDuty',
        mitigation_strategy: 'Retry with exponential backoff, switch to backup channel',
        fallback_action: 'Queue message locally, retry every 60s until delivered'
      },
      {
        failure_mode: 'ALERT_FATIGUE_DETECTED',
        probability: 0.15,
        severity: 'high',
        detection_method: '>20 identical alerts in 10 minutes',
        mitigation_strategy: 'Enable aggressive grouping, send digest instead of individual',
        fallback_action: 'Suppress duplicates, log summary, notify admin'
      }
    ];

    super(config, notificationFmea);
    this.channelManager = new ChannelManager();
  }

  // ==================== LIFECYCLE ====================

  protected async getCapabilities(): Promise<string[]> {
    return ['multi_channel_routing', 'alert_grouping', 'delivery_tracking', 'template_formatting'];
  }

  protected async onInit(): Promise<void> {
    // Listen for direct notification requests
    this.acp.listenForTasks<NotificationRequest, NotificationReport>(
      'send_notification',
      this.handleNotificationRequest.bind(this)
    );

    // Auto-listen for system events
    this.acp.listenForEvents<any>('alert.triggered', (payload) => this.processSystemEvent('alert', payload));
    this.acp.listenForEvents<any>('incident.escalation', (payload) => this.processSystemEvent('incident', payload));
    this.acp.listenForEvents<any>('deployment.completed', (payload) => this.processSystemEvent('deployment', payload));

    await this.audit.commit({
      agent_id: this.id,
      action: 'initialized',
      status: 'success',
      data: { version: this.identity.version }
    });

    console.log(`📢 Notification Agent [${this.id}] initialized and listening for events...`);
  }

  protected async onStop(): Promise<void> {
    console.log(`🛑 Notification Agent [${this.id}] shutting down.`);
  }

  // ==================== DOMAIN LOGIC ====================

  private async handleNotificationRequest(
    payload: NotificationRequest,
    message: ACPMessage<NotificationRequest>
  ): Promise<NotificationReport> {
    return this.executeDelivery(payload.recipients, payload.priority, payload.title, payload.message, payload.context);
  }

  private async processSystemEvent(eventType: string, payload: any): Promise<void> {
    const priority: AlertPriority = payload.severity === 'critical' ? 'critical' 
      : payload.severity === 'warning' ? 'high' : 'medium';
    
    const title = `${eventType.charAt(0).toUpperCase() + eventType.slice(1)}: ${payload.source || 'System'}`;
    const message = payload.message || `Automated ${eventType} notification triggered.`;
    const recipients = priority === 'critical' ? ['oncall@company.com', '#ops-alerts'] : ['#dev-notifications'];

    await this.executeDelivery(recipients, priority, title, message, payload);
  }

  private async executeDelivery(
    recipients: string[],
    priority: AlertPriority,
    title: string,
    message: string,
    context?: Record<string, any>
  ): Promise<NotificationReport> {
    const span = this.telemetry.startSpan('notification.execute_delivery');
    try {
      const allDeliveries: DeliveryResult[] = [];

      for (const recipient of recipients) {
        const deliveries = await this.channelManager.routeAndDeliver({
          recipient,
          priority,
          title,
          message,
          metadata: context
        });
        allDeliveries.push(...deliveries);
      }

      const failedCount = allDeliveries.filter(d => d.status === 'failed').length;
      const status = failedCount === 0 ? 'sent' : (failedCount < allDeliveries.length ? 'partial' : 'failed');

      // Audit
      await this.audit.commit({
        agent_id: this.id,
        action: 'notifications_sent',
        status: status === 'sent' ? 'success' : 'warning',
        data: { requestId: `notif_${Date.now()}`, status, recipients: recipients.length, failed: failedCount }
      });

      span.setStatus('ok');
      return { requestId: `notif_${Date.now()}`, status, deliveries: allDeliveries, timestamp: Date.now() };

    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      span.setStatus('error', err.message);
      this.telemetry.recordError(span, err);
      await this.fmea.handle(err, 'notification_delivery_pipeline');
      throw error;
    } finally {
      span.end();
    }
  }
}
