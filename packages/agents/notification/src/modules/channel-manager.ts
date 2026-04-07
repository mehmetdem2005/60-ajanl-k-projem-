// packages/agents/notification/src/modules/channel-manager.ts
// Channel Manager Module
// Priority-based routing, rate limiting, and fallback delivery logic.
// Prevents alert fatigue and ensures critical notifications reach on-call personnel.

export type ChannelType = 'slack' | 'email' | 'pagerduty' | 'webhook' | 'sms';
export type AlertPriority = 'low' | 'medium' | 'high' | 'critical';

export interface NotificationPayload {
  recipient: string; // user, channel ID, or email
  channel: ChannelType;
  priority: AlertPriority;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

export interface DeliveryResult {
  channelId: string;
  status: 'delivered' | 'failed' | 'rate_limited' | 'fallback_used';
  timestamp: number;
  error?: string;
}

export class ChannelManager {
  private readonly rateLimiters: Map<string, { count: number; resetAt: number }> = new Map();
  private readonly MAX_RATE_PER_MINUTE = 30;

  /**
   * Routes notification through appropriate channels based on priority.
   * Implements fallback chain: if primary fails, try secondary.
   */
  async routeAndDeliver(payload: Omit<NotificationPayload, 'channel'>): Promise<DeliveryResult[]> {
    const targetChannels = this.selectChannels(payload.priority);
    const results: DeliveryResult[] = [];

    for (const channel of targetChannels) {
      const msg = { ...payload, channel };
      
      // 1. Rate Limiting & Deduplication Check
      if (this.isRateLimited(channel)) {
        results.push({ channelId: channel, status: 'rate_limited', timestamp: Date.now() });
        continue;
      }

      // 2. Attempt Delivery
      try {
        const success = await this.attemptDelivery(channel, msg);
        results.push({
          channelId: channel,
          status: success ? 'delivered' : 'failed',
          timestamp: Date.now()
        });
        if (success) break; // Stop after first successful delivery
      } catch (error) {
        results.push({
          channelId: channel,
          status: 'fallback_used',
          timestamp: Date.now(),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return results;
  }

  private selectChannels(priority: AlertPriority): ChannelType[] {
    switch (priority) {
      case 'critical': return ['pagerduty', 'slack', 'sms'];
      case 'high':     return ['slack', 'email'];
      case 'medium':   return ['slack'];
      case 'low':      return ['webhook'];
      default:         return ['webhook'];
    }
  }

  private isRateLimited(channel: string): boolean {
    const minuteKey = Math.floor(Date.now() / 60000);
    const key = `${channel}:${minuteKey}`;
    const state = this.rateLimiters.get(key) || { count: 0, resetAt: minuteKey + 1 };
    
    if (state.count >= this.MAX_RATE_PER_MINUTE) return true;
    
    this.rateLimiters.set(key, { count: state.count + 1, resetAt: state.resetAt });
    return false;
  }

  private async attemptDelivery(channel: ChannelType, payload: NotificationPayload): Promise<boolean> {
    // Mock API integration (Replace with actual Slack/PagerDuty/SMS SDK in production)
    await new Promise(r => setTimeout(r, 300));
    
    // Simulate 95% success rate
    if (Math.random() < 0.05) throw new Error(`Provider API error for ${channel}`);
    return true;
  }
}
