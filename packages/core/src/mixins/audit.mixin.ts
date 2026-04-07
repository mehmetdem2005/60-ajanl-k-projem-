// packages/core/src/mixins/audit.mixin.ts
// Immutable Audit Trail Implementation
// Implements IAudit interface defined in types.ts
// Cryptographically linked via SHA-256

import crypto from 'crypto';
import { IAudit, AuditConfig, AuditEntry } from '../types';

export class AuditMixin implements IAudit {
  private config: AuditConfig;
  private lastHash: string;

  // In-memory storage for the audit chain.
  // In production, this would be flushed to Database/S3/QLDB.
  private entries: AuditEntry[] = [];

  constructor(config: AuditConfig) {
    this.config = {
      storage_driver: 'memory',
      encryption_enabled: true,
      retention_days: 365,
      worm_mode: true,
      ...config
    };

    // Genesis hash for the first block in the chain
    this.lastHash = crypto.createHash('sha256').update('planner-genesis-block').digest('hex');
  }

  /**
   * Commits a new entry to the audit trail.
   * Calculates the hash based on content + previous hash to ensure immutability.
   */
  async commit(entryData: Omit<AuditEntry, 'hash' | 'timestamp' | 'prev_hash' | 'id'>): Promise<string> {
    const timestamp = new Date().toISOString();
    const id = crypto.randomUUID();

    const entry: AuditEntry = {
      ...entryData,
      id,
      timestamp,
      prev_hash: this.lastHash,
      hash: '', // Will be calculated
      status: entryData.status || 'success'
    };

    // Calculate Hash: SHA-256(ID + Timestamp + Agent + Action + Data + PrevHash)
    // Including all fields ensures that if any data is changed, the hash breaks.
    const contentToHash = JSON.stringify({
      id: entry.id,
      timestamp: entry.timestamp,
      agent_id: entry.agent_id,
      action: entry.action,
      status: entry.status,
      data: entry.data,
      prev_hash: entry.prev_hash
    });

    entry.hash = crypto.createHash('sha256').update(contentToHash).digest('hex');

    // Store entry
    this.entries.push(entry);

    // Update chain pointer
    this.lastHash = entry.hash;

    // Simulate persistence (In production, await DB insert here)
    // console.debug(`[AUDIT] Committed: ${entry.action} | Hash: ${entry.hash}`);

    return entry.hash;
  }

  /**
   * Verifies the integrity of the entire audit chain.
   * Returns false if any link is broken (tampering detected).
   */
  async verifyChain(): Promise<boolean> {
    let currentHash = crypto.createHash('sha256').update('planner-genesis-block').digest('hex');

    for (const entry of this.entries) {
      // 1. Check Link Integrity (prev_hash matches previous entry's hash)
      if (entry.prev_hash !== currentHash) {
        console.error(`[AUDIT] Chain broken at entry ${entry.id}: prev_hash mismatch.`);
        return false;
      }

      // 2. Check Content Integrity (Hash matches data)
      const contentToHash = JSON.stringify({
        id: entry.id,
        timestamp: entry.timestamp,
        agent_id: entry.agent_id,
        action: entry.action,
        status: entry.status,
        data: entry.data,
        prev_hash: entry.prev_hash
      });

      const expectedHash = crypto.createHash('sha256').update(contentToHash).digest('hex');

      if (entry.hash !== expectedHash) {
        console.error(`[AUDIT] Hash mismatch at entry ${entry.id}: Data tampered.`);
        return false;
      }

      // Move to next link
      currentHash = entry.hash;
    }

    return true;
  }

  /**
   * Utility: Get all entries (For debugging or export)
   */
  public async getEntries(): Promise<AuditEntry[]> {
    return [...this.entries];
  }

  /**
   * Utility: Get last known hash
   */
  public getLastHash(): string {
    return this.lastHash;
  }
}
