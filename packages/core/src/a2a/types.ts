/**
 * A2A domain model.
 *
 * This module intentionally models A2A semantics inside Open-Agent-Teams before
 * committing to any specific transport. In-process, HTTP, Redis, and NATS
 * transports should all carry these same domain objects.
 */

export type A2ARole = 'user' | 'agent';

export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'rejected'
  | 'auth_required'
  | 'unknown';

export type A2APart =
  | {
      kind: 'text';
      text: string;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'data';
      data: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: 'file';
      uri?: string;
      bytes?: string;
      mimeType?: string;
      name?: string;
      metadata?: Record<string, unknown>;
    };

export interface A2AMessage {
  messageId: string;
  contextId?: string;
  taskId?: string;
  role: A2ARole;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
  referenceTaskIds?: string[];
}

export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}

export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: A2AMessage;
  timestamp?: string;
}

export interface A2ATask {
  id: string;
  contextId?: string;
  status: A2ATaskStatus;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  metadata?: Record<string, unknown>;
}

export interface A2ATaskStatusUpdateEvent {
  kind: 'status-update';
  taskId: string;
  contextId: string;
  status: A2ATaskStatus;
  metadata?: Record<string, unknown>;
}

export interface A2ATaskArtifactUpdateEvent {
  kind: 'artifact-update';
  taskId: string;
  contextId: string;
  artifact: A2AArtifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export type A2AEvent = A2ATaskStatusUpdateEvent | A2ATaskArtifactUpdateEvent;

export interface A2AAgentSkill {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  examples?: string[];
}

export interface A2AAgentCapabilities {
  streaming?: boolean;
  pushNotifications?: boolean;
  stateTransitionHistory?: boolean;
  pauseResume?: boolean;
}

export interface A2AAgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url?: string;
  version: string;
  documentationUrl?: string;
  capabilities: A2AAgentCapabilities;
  defaultInputModes: string[];
  defaultOutputModes: string[];
  skills: A2AAgentSkill[];
  preferredTransport?: 'JSONRPC' | 'HTTP+JSON' | 'GRPC' | string;
  additionalInterfaces?: Array<{
    transport: 'JSONRPC' | 'HTTP+JSON' | 'GRPC' | string;
    url: string;
  }>;
  metadata?: Record<string, unknown>;
}

export interface A2ASendMessageRequest {
  message: A2AMessage;
  configuration?: {
    acceptedOutputModes?: string[];
    blocking?: boolean;
    historyLength?: number;
  };
  metadata?: Record<string, unknown>;
}

export type A2ASendMessageResult = A2AMessage | A2ATask;

export function isA2ATask(value: A2ASendMessageResult): value is A2ATask {
  return 'status' in value && 'id' in value;
}

export function isTerminalA2ATaskState(state: A2ATaskState): boolean {
  return state === 'completed' || state === 'failed' || state === 'canceled' || state === 'rejected';
}
