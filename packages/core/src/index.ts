// packages/core/src/index.ts
// Main Entry Point for @planner/core
// Exports all public interfaces, classes, and types to be consumed by Agent packages.

// ==================== TYPES ====================
export * from './types';

// ==================== MIXINS ====================
export * from './mixins/audit.mixin';
export * from './mixins/telemetry.mixin';
export * from './mixins/fmea.mixin';

// ==================== COMMUNICATION (ACP) ====================
export * from './acp/adapter';
export * from './acp/registry';
export * from './acp/registry-http-client';
// We also export ACP types so agents can define their message contracts strictly
export * from './acp/types';

// ==================== WORKFLOW (SAGA) ====================
export * from './workflow/saga';

// ==================== BASE AGENT ====================
export * from './base-agent';
